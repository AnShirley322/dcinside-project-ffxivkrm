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
  if (!PI.ok) return;

  const MAP_URL =
    "https://raw.githubusercontent.com/AnShirley322/dcinside-project-ffxivkrm/main/map.json";

  /* ========== 유틸 ========== */
  function cleanKey(s) {
    if (!s) return "";
    return s
      .replace(/[\u00A0\u200B\u200C\u200D\uFEFF]/g, "")
      .replace(/\u3000/g, " ")
      .replace(/[“”„‟«»‚‘’‹›"']/g, "")
      .replace(/[&;]+$/g, "")
      .trim()
      .replace(/\s+/g, " ");
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
      console.log("[FFXIVKR IMG] map.json 불러오기 성공:", Object.keys(KEYMAP).length, "개");
    } else {
      console.warn("[FFXIVKR IMG] map.json 불러오기 실패:", res.status);
    }
  } catch (e) {
    console.warn("[FFXIVKR IMG] map.json 불러오기 오류:", e);
  }

  function normUrl(u) {
    try { return decodeURIComponent(u).replace(/"/g, "&quot;"); } catch { return u; }
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
      } catch {}
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
  const ZW = "[\\u200B\\u200C\\u200D\\uFEFF]*";
  const IMG_MARK_RE = new RegExp(
    "(?:&lt;|&amp;lt;|[<\\uFF1C\\u3008])" + ZW +
      "\\s*이미지\\s*:\\s*([" + "“”'`" + "]?)" + ZW +
      "\\s*([\\s\\S]*?)\\s*" + ZW + "\\1\\s*" + ZW +
    "(?:&gt;|&amp;gt;|[>\\uFF1E\\u3009])",
    "gi"
  );

  function replaceMarkersInString(str) {
    const matches = Array.from(str.matchAll(IMG_MARK_RE));
    console.log("[FFXIVKR IMG] 매칭 시도:", matches.length, "건");
    return str.replace(IMG_MARK_RE, (m, _q, rawKey) => {
      const key = cleanKey(rawKey);
      const url = KEYMAP[key];
      if (!url) return m;
      return `<img src="${url.replace(/"/g, "&quot;")}" alt="${key}" />`;
    });
  }

  function toMarkerText(key) {
    return `\u200B&lt;이미지:${key}&gt;\u200B`;
  }
  function replaceImgsWithMarkers(str) {
    return str.replace(/<img[^>]*\ssrc="([^"]+)"[^>]*>/gi, (m, src) => {
      const key = REVMAP[normUrl(src)];
      return key ? toMarkerText(key) : m;
    });
  }
  function ensureCaretGapsText(s) {
    s = s.replace(/(\S)(?=(?:\u200B)?&lt;이미지:)/g, "$1 ");
    s = s.replace(/(&lt;이미지:[^>]+&gt;)(?=\S)/g, "$1 ");
    s = s.replace(/(&lt;이미지:[^>]+&gt;)(?:\u200B)?(?=(?:\u200B)?&lt;이미지:)/g, "$1\n");
    return s;
  }
  function ensureCaretGapsHTML(html) {
    html = html.replace(/(\S)(?=(?:\u200B)?&lt;이미지:)/g, "$1 ");
    html = html.replace(/(&lt;이미지:[^>]+&gt;)(?=\S)/g, "$1 ");
    html = html.replace(/(&lt;이미지:[^>]+&gt;)(?:\u200B)?(?=(?:\u200B)?&lt;이미지:)/g, "$1<br>");
    return html;
  }

  /* ========== 커서 유틸 (수정페이지에서 자동 배치) ========== */
  function placeCaretEnd(node) {
    try {
      node.focus();
      const doc = node.ownerDocument;
      const win = doc.defaultView || window;
      if ("value" in node) {
        const len = node.value.length;
        node.setSelectionRange(len, len);
      } else {
        const range = doc.createRange();
        range.selectNodeContents(node);
        range.collapse(false);
        const sel = win.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
    } catch {}
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

  function processAllEditors() {
    const editors = getAllEditors();
    let changedCount = 0;
    editors.forEach((ed) => {
      try {
        if (ed.type === "textarea") {
          const before = ed.el.value;
          const after = replaceMarkersInString(before);
          if (before !== after) {
            applyChangeToNode(ed.el, after);
            changedCount++;
          }
        } else if (ed.type === "contenteditable") {
          const before = ed.el.innerHTML;
          const after = replaceMarkersInString(before);
          if (before !== after) {
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

  /* ========== 수정페이지: 초기 1회 역변환 + 라이브 감시 ========== */
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
    if (changed) {
      const main = findPrimaryEditor();
      if (main?.el) placeCaretEnd(main.el); // 커서가 사라지는 문제 방지
      console.log("[FFXIVKR IMG] 수정페이지 역변환 완료:", changed, "개 필드");
    }
  }

  // 변경 감시: 에디터 DOM에 이미지가 들어오면 즉시 표식으로 교체
  function observeModifyEditors() {
    const editors = getAllEditors();
    const opts = { childList: true, subtree: true, characterData: true };

    editors.forEach((ed) => {
      const doc = ed.doc || document;
      const root = ed.el.closest("form") || doc.body; // 폼 전체 감시(에디터 외부에서 끼워넣는 경우 대비)
      if (!root) return;

      const obs = new MutationObserver((mutations) => {
        let touched = false;
        for (const m of mutations) {
          // 빠른 경로: 추가된 노드 중 IMG가 있으면 처리
          for (const n of m.addedNodes || []) {
            if (n.nodeType === 1) {
              const el = /** @type {Element} */ (n);
              if (el.matches && el.matches("img")) { touched = true; break; }
              if (el.querySelector && el.querySelector("img")) { touched = true; break; }
            }
          }
          if (touched) break;
        }
        if (touched) {
          // 에디터 타입별로 다시 역변환 + 간격 보정 + 커서 복구
          try {
            if (ed.type === "textarea") {
              let val = ed.el.value || "";
              const next = ensureCaretGapsText(replaceImgsWithMarkers(val));
              if (val !== next) {
                ed.el.value = next;
                placeCaretEnd(ed.el);
              }
            } else if (ed.type === "contenteditable") {
              let html = ed.el.innerHTML || "";
              const next = ensureCaretGapsHTML(replaceImgsWithMarkers(html));
              if (html !== next) {
                ed.el.innerHTML = next;
                placeCaretEnd(ed.el);
              }
            }
          } catch {}
        }
      });

      try { obs.observe(root, opts); } catch {}
    });

    // 초기 몇 초 동안 딜레이 로딩을 재보정 (1초 간격 5회)
    let cnt = 0;
    const timer = setInterval(() => {
      cnt++;
      convertImgsToMarkersOnce();
      if (cnt >= 5) clearInterval(timer);
    }, 1000);
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (PI.isModify) {
      convertImgsToMarkersOnce();  // 초기 역변환
      observeModifyEditors();      // 이후 유입되는 IMG도 즉시 표식화
    }
  });

  /* ========== 제출 직전: 표식 → 이미지 ========== */
  window.addEventListener("submit", () => {
    const okAll = processAllEditors();
    console.log("[FFXIVKR IMG] submit 시 변환(모두):", okAll);
  }, true);

  /* ========== 버튼 ========== */
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
      ? "수정 화면은 편집 편의를 위해 표식을 유지합니다. 저장 시 자동 변환됩니다."
      : "본문의 <이미지:키워드> 표식을 <img>로 변환";
    btn.addEventListener("click", () => {
      if (PI.isModify) {
        toast("수정 화면에서는 제출 시 자동 변환됩니다 (편집 중에는 표식 유지).");
        const ed = findPrimaryEditor(); // 커서가 사라져 있다면 복구
        if (ed?.el) placeCaretEnd(ed.el);
        return;
      }
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
