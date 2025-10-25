(async () => {
  /* ===== 실행 대상 갤러리 제한: ffxivkr (mgallery 글쓰기/수정만) ===== */
  const TARGET_GALLERY_ID = "ffxivkr";
  function pageInfo() {
    try {
      const u = new URL(location.href);
      const isWrite = /\/mgallery\/board\/write\//.test(u.pathname);
      const isModify = /\/mgallery\/board\/modify\//.test(u.pathname);
      const id = u.searchParams.get("id");
      return { isWrite, isModify, id, ok: (id === TARGET_GALLERY_ID) && (isWrite || isModify) };
    } catch {
      return { isWrite: false, isModify: false, id: null, ok: false };
    }
  }
  const PI = pageInfo();
  if (!PI.ok) return; // 대상이 아니면 아무 것도 하지 않음

  //
  const MAP_URL =
    "https://raw.githubusercontent.com/AnShirley322/dcinside-project-ffxivkrm/main/map.json";

  /* ========== 유틸 ========== */
  function cleanKey(s) {
    if (!s) return "";
    return s
      .replace(/[\u00A0\u200B\u200C\u200D\uFEFF]/g, "") // 숨은 공백 제거
      .replace(/\u3000/g, " ")                           // 전각공백 → 일반공백
      .replace(/[“”„‟«»‚‘’‹›"']/g, "")                  // 따옴표류 제거
      .replace(/[&;]+$/g, "")                            // 꼬리 & ; 제거
      .trim()
      .replace(/\s+/g, " ");                             // 연속 공백 1칸
  }

  function normalizeKeymap(rawMap) {
    const out = {};
    for (const [k, v] of Object.entries(rawMap || {})) {
      const nk = cleanKey(k);
      if (nk) out[nk] = v;
    }
    return out;
  }

  function toast(msg) {
    const id = "ffxivkr-toast";
    let t = document.getElementById(id);
    if (!t) {
      t = document.createElement("div");
      t.id = id;
      Object.assign(t.style, {
        position: "fixed",
        left: "50%",
        bottom: "24px",
        transform: "translateX(-50%)",
        background: "rgba(34,197,94,.95)",
        color: "#fff",
        padding: "8px 12px",
        borderRadius: "10px",
        zIndex: 2147483647,
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
        fontSize: "13px",
        boxShadow: "0 8px 16px rgba(0,0,0,.25)"
      });
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.display = "block";
    clearTimeout(t._tmr);
    t._tmr = setTimeout(() => (t.style.display = "none"), 1300);
  }

  /* ========== map.json 로드 & 역매핑 준비 ========== */
  let KEYMAP = {};
  let REVMAP = {};
  try {
    const res = await fetch(MAP_URL, { cache: "no-cache" });
    if (res.ok) {
      const raw = await res.json();
      KEYMAP = normalizeKeymap(raw);
      REVMAP = buildReverseMap(KEYMAP);
      console.log("[FFXIVKR IMG] map.json 불러오기 성공:", Object.keys(KEYMAP).length, "개 항목");
    } else {
      console.warn("[FFXIVKR IMG] map.json 불러오기 실패:", res.status);
    }
  } catch (e) {
    console.warn("[FFXIVKR IMG] map.json 불러오기 오류:", e);
  }

  function normUrl(u) {
    try {
      return decodeURIComponent(u).replace(/"/g, "&quot;");
    } catch {
      return u;
    }
  }
  function buildReverseMap(keymap) {
    const rev = {};
    for (const [k, url] of Object.entries(keymap || {})) {
      rev[normUrl(url)] = k;
    }
    return rev;
  }

  /* ========== 에디터 찾기 ========== */
  function getAllEditors(rootDoc) {
    const arr = [];
    const doc = rootDoc || document;

    doc.querySelectorAll("textarea").forEach((ta) => {
      arr.push({ type: "textarea", el: ta, doc, where: "textarea" });
    });
    doc.querySelectorAll('[contenteditable="true"]').forEach((el) => {
      arr.push({ type: "contenteditable", el, doc, where: "contenteditable" });
    });
    doc.querySelectorAll("iframe").forEach((ifr) => {
      try {
        const idoc = ifr.contentDocument;
        if (idoc) arr.push(...getAllEditors(idoc));
      } catch { /* cross-origin */ }
    });

    return arr;
  }

  function findPrimaryEditor() {
    const doc = document;
    const taNamed =
      doc.querySelector('textarea[name="memo"]') ||
      doc.querySelector('textarea[name="content"]') ||
      doc.querySelector("#memo") ||
      doc.querySelector("#content");
    if (taNamed) return { type: "textarea", el: taNamed, doc, where: "textarea[name]" };

    const anyTa = doc.querySelector("textarea");
    if (anyTa) return { type: "textarea", el: anyTa, doc, where: "textarea" };

    const ce = doc.querySelector('[contenteditable="true"]');
    if (ce) return { type: "contenteditable", el: ce, doc, where: "contenteditable" };

    const all = getAllEditors();
    return all[0] || null;
  }

  /* ========== 패턴/치환 ========== */
  // <이미지:키> 표식 인식 (엔티티/전각 괄호/따옴표 허용 + 제로폭 허용)
  const ZW = "[\\u200B\\u200C\\u200D\\uFEFF]*";
  const IMG_MARK_RE = new RegExp(
    "(?:&lt;|&amp;lt;|[<\\uFF1C\\u3008])" + ZW +
      "\\s*이미지\\s*:\\s*([" + "“”'`" + "]?)" + ZW +
      "\\s*([\\s\\S]*?)\\s*" + ZW + "\\1\\s*" + ZW +
    "(?:&gt;|&amp;gt;|[>\\uFF1E\\u3009])",
    "gi"
  );

  // 표식 → <img>  (제출/미리보기에서 사용)
  function replaceMarkersInString(str) {
    const matches = Array.from(str.matchAll(IMG_MARK_RE));
    console.log("[FFXIVKR IMG] 매칭 시도:", matches.length, "건");
    return str.replace(IMG_MARK_RE, (m, _q, rawKey) => {
      const key = cleanKey(rawKey);
      const url = KEYMAP[key];
      console.log("[FFXIVKR IMG] 키:", JSON.stringify(key), "→", url ? "HIT" : "MISS");
      if (!url) return m;
      return `<img src="${url.replace(/"/g, "&quot;")}" alt="${key}" />`;
    });
  }

  // 안전한 표식 문자열: 앞뒤에 제로폭 스페이스로 커서 틈 제공
  function toMarkerText(key) {
    return `\u200B&lt;이미지:${key}&gt;\u200B`;
  }

  // <img src="..."> → \u200B&lt;이미지:키&gt;\u200B  (수정 페이지에서 사용)
  function replaceImgsWithMarkers(str) {
    return str.replace(/<img[^>]*\ssrc="([^"]+)"[^>]*>/gi, (m, src) => {
      const key = REVMAP[normUrl(src)];
      return key ? toMarkerText(key) : m;
    });
  }

  // 표식 주변 간격 확보 (textarea)
  function ensureCaretGapsText(s) {
    s = s.replace(/(\S)(?=(?:\u200B)?&lt;이미지:)/g, "$1 ");
    s = s.replace(/(&lt;이미지:[^>]+&gt;)(?=\S)/g, "$1 ");
    s = s.replace(/(&lt;이미지:[^>]+&gt;)(?:\u200B)?(?=(?:\u200B)?&lt;이미지:)/g, "$1\n");
    return s;
  }
  // 표식 주변 간격 확보 (contenteditable HTML)
  function ensureCaretGapsHTML(html) {
    html = html.replace(/(\S)(?=(?:\u200B)?&lt;이미지:)/g, "$1 ");
    html = html.replace(/(&lt;이미지:[^>]+&gt;)(?=\S)/g, "$1 ");
    html = html.replace(/(&lt;이미지:[^>]+&gt;)(?:\u200B)?(?=(?:\u200B)?&lt;이미지:)/g, "$1<br>");
    return html;
  }

  /* ========== 변환 실행 ========== */
  function applyChangeToNode(node, nextValue) {
    if ("value" in node) {
      node.value = nextValue;
      node.dispatchEvent(new Event("input", { bubbles: true }));
      node.dispatchEvent(new Event("change", { bubbles: true }));
      node.dispatchEvent(new Event("keyup", { bubbles: true }));
    } else {
      node.innerHTML = nextValue;
    }
  }

  // 모든 에디터에서 표식→이미지 변환 (제출 시에만 사용)
  function processAllEditors() {
    const editors = getAllEditors();
    let changedCount = 0;

    editors.forEach((ed) => {
      try {
        if (ed.type === "textarea") {
          const before = ed.el.value;
          const after = replaceMarkersInString(before);
          if (before !== after) {
            console.log("[FFXIVKR IMG] textarea changed length:", before.length, "→", after.length);
            applyChangeToNode(ed.el, after);
            changedCount++;
          }
        } else if (ed.type === "contenteditable") {
          const before = ed.el.innerHTML;
          const after = replaceMarkersInString(before);
          if (before !== after) {
            console.log("[FFXIVKR IMG] CE changed length:", before.length, "→", after.length);
            applyChangeToNode(ed.el, after);
            changedCount++;
          }
        }
      } catch (e) {
        console.warn("[FFXIVKR IMG] 처리 오류:", e);
      }
    });

    if (changedCount > 0) toast(`이미지 표식 치환: ${changedCount}개 필드`);
    return changedCount > 0;
  }

  // 수정 페이지: 이미지→표식 역변환(1회) + 커서 틈 보장
  function convertImgsToMarkersOnce() {
    const editors = getAllEditors();
    let changed = 0;
    editors.forEach((ed) => {
      try {
        if (ed.type === "textarea") {
          const before = ed.el.value || "";
          let after = replaceImgsWithMarkers(before);
          after = ensureCaretGapsText(after);
          if (before !== after) { ed.el.value = after; changed++; }
        } else if (ed.type === "contenteditable") {
          const before = ed.el.innerHTML || "";
          let after = replaceImgsWithMarkers(before);
          after = ensureCaretGapsHTML(after);
          if (before !== after) { ed.el.innerHTML = after; changed++; }
        }
      } catch {}
    });
    if (changed) console.log("[FFXIVKR IMG] 수정페이지 역변환 완료:", changed, "개 필드");
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (PI.isModify) convertImgsToMarkersOnce(); // 수정 화면에서는 항상 편집용 표식 상태로
  });

  /* ========== 제출 직전 강제 변환(표식→이미지) ========== */
  window.addEventListener("submit", () => {
    const okAll = processAllEditors();
    console.log("[FFXIVKR IMG] submit 시 변환(모두):", okAll);
  }, true);

  /* ========== 수동 변환 버튼 ========== */
  function mountButton() {
    if (document.getElementById("ffxivkr-btn")) return;
    const btn = document.createElement("button");
    btn.id = "ffxivkr-btn";
    btn.textContent = PI.isModify ? "ℹ️ 수정: 제출 시 자동 변환" : "🔄 <이미지:키> 변환";
    Object.assign(btn.style, {
      position: "fixed",
      right: "16px",
      bottom: "16px",
      zIndex: 2147483647,
      padding: "10px 12px",
      borderRadius: "10px",
      border: "none",
      cursor: "pointer",
      background: PI.isModify ? "#6b7280" : "#3b82f6",
      color: "#fff",
      fontWeight: "600",
      boxShadow: "0 8px 16px rgba(0,0,0,.25)"
    });
    btn.title = PI.isModify
      ? "수정 화면에서는 편집 편의를 위해 표식 상태를 유지합니다. 저장(제출) 시 자동으로 이미지로 변환됩니다."
      : "본문의 <이미지:키워드> 표식을 <img> 태그로 변환";

    btn.addEventListener("click", () => {
      if (PI.isModify) {
        toast("수정 화면에서는 제출 시 자동 변환됩니다 (편집 중에는 표식 유지).");
        return; // 수정 화면에서는 수동 변환 금지: 타이핑 막힘 방지
      }
      const okAll = processAllEditors(); // 글쓰기 페이지에서만 수동 변환 허용
      btn.textContent = okAll ? "✅ 변환 완료" : "ℹ️ 변환할 항목 없음";
      setTimeout(() => (btn.textContent = "🔄 <이미지:키> 변환"), 1200);
    });

    document.body.appendChild(btn);
  }

  document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", mountButton)
    : mountButton();
})();
