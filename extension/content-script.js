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
        boxShadow: "0 8px 24px rgba(0,0,0,.25)"
      });
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.display = "block";
    clearTimeout(t._tmr);
    t._tmr = setTimeout(() => (t.style.display = "none"), 1200);
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
  // <이미지:키> 표식 인식 (엔티티/전각 괄호/따옴표 허용)
  const IMG_MARK_RE =
    /(?:&lt;|&amp;lt;|[<\uFF1C\u3008])\s*이미지\s*:\s*(["“”'`]?)\s*([\s\S]*?)\s*\1\s*(?:&gt;|&amp;gt;|[>\uFF1E\u3009])/gi;

  // 표식 → <img>
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

  // <img src="..."> → &lt;이미지:키&gt; (수정 페이지에서 사용)
  function replaceImgsWithMarkers(str) {
    return str.replace(/<img[^>]*\ssrc="([^"]+)"[^>]*>/gi, (m, src) => {
      const key = REVMAP[normUrl(src)];
      return key ? `&lt;이미지:${key}&gt;` : m;
    });
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

  // 모든 에디터에서 표식→이미지 변환
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

  // 단일 에디터만(버튼에서 사용)
  function processEditorNow(editor) {
    if (!editor) editor = findPrimaryEditor();
    console.log("[FFXIVKR IMG] editor:", editor && editor.where);
    if (!editor) return false;

    if (editor.type === "textarea") {
      const before = editor.el.value;
      const after = replaceMarkersInString(before);
      if (before !== after) {
        console.log("[FFXIVKR IMG] length:", before.length, "→", after.length);
        console.log("[FFXIVKR IMG] AFTER preview:", (after || "").slice(0, 200));
        applyChangeToNode(editor.el, after);
        return true;
      }
    } else if (editor.type === "contenteditable") {
      const before = editor.el.innerHTML;
      const after = replaceMarkersInString(before);
      if (before !== after) {
        console.log("[FFXIVKR IMG] length:", before.length, "→", after.length);
        console.log("[FFXIVKR IMG] AFTER preview:", (after || "").slice(0, 200));
        applyChangeToNode(editor.el, after);
        return true;
      }
    }
    return false;
  }

  /* ========== 수정 페이지: 이미지→표식 역변환(1회) ========== */
  function isModifyPage() {
    const p = location.pathname;
    return /\/board\/modify\//.test(p);
  }

  function convertImgsToMarkersOnce() {
    const editors = getAllEditors();
    let changed = 0;
    editors.forEach((ed) => {
      try {
        if (ed.type === "textarea") {
          const before = ed.el.value || "";
          const after = replaceImgsWithMarkers(before);
          if (before !== after) {
            ed.el.value = after;
            changed++;
          }
        } else if (ed.type === "contenteditable") {
          const before = ed.el.innerHTML || "";
          const after = replaceImgsWithMarkers(before);
          if (before !== after) {
            ed.el.innerHTML = after;
            changed++;
          }
        }
      } catch {}
    });
    if (changed) console.log("[FFXIVKR IMG] 수정페이지 역변환 완료:", changed, "개 필드");
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (isModifyPage()) convertImgsToMarkersOnce();
  });

  /* ========== 제출 직전 강제 변환(표식→이미지) ========== */
  window.addEventListener(
    "submit",
    () => {
      const okAll = processAllEditors();
      console.log("[FFXIVKR IMG] submit 시 변환(모두):", okAll);
    },
    true
  );

  /* ========== 수동 변환 버튼 ========== */
  function mountButton() {
    if (document.getElementById("ffxivkr-btn")) return;
    const btn = document.createElement("button");
    btn.id = "ffxivkr-btn";
    btn.textContent = "🔄 <이미지:키> 변환";
    Object.assign(btn.style, {
      position: "fixed",
      right: "16px",
      bottom: "16px",
      zIndex: 2147483647,
      padding: "10px 12px",
      borderRadius: "10px",
      border: "none",
      cursor: "pointer",
      background: "#3b82f6",
      color: "#fff",
      fontWeight: "600",
      boxShadow: "0 6px 16px rgba(0,0,0,.25)"
    });
    btn.title = "본문의 <이미지:키워드> 표식을 <img> 태그로 변환 (저장 시에도 자동 변환)";
    btn.addEventListener("click", () => {
      const okAll = processAllEditors();
      btn.textContent = okAll ? "✅ 변환 완료" : "ℹ️ 변환할 항목 없음";
      setTimeout(() => (btn.textContent = "🔄 <이미지:키> 변환"), 1200);
    });
    document.body.appendChild(btn);
  }

  document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", mountButton)
    : mountButton();
})();
