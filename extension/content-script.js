(async () => {
  /* ===== 대상 갤 제한: 탑 프레임에서만 엄격 검사, iframe에서는 완화 ===== */
  const TARGET_GALLERY_ID = "ffxivkr";
  const IS_TOP = window.top === window;

  function topPageInfoFallback() {
    // 탑 프레임에서만 호출
    try {
      const u = new URL(location.href);
      const isWrite  = /\/mgallery\/board\/write\//i.test(u.pathname);
      const isModify = /\/mgallery\/board\/modify\//i.test(u.pathname);
      const id = u.searchParams.get("id");
      return { isWrite, isModify, id, ok: (id === TARGET_GALLERY_ID) && (isWrite || isModify) };
    } catch {
      return { isWrite: false, isModify: false, id: null, ok: false };
    }
  }

  // 프레임별 실행 허용 여부 결정
  let PI = { isWrite: false, isModify: false, ok: true };
  if (IS_TOP) {
    PI = topPageInfoFallback();
    if (!PI.ok) return; // 탑이 대상이 아니면 종료
  } else {
    // 하위 프레임(에디터)의 경우: 탑 프레임이 이미 대상 페이지여야 주입됨
    // 크로스오리진이면 top.location 접근 불가 → 그냥 동작 허용 (manifest로 이미 경로 제한됨)
    PI.ok = true;
    // 수정/쓰기 추정치: URL path가 비어있을 수 있어 폼/버튼을 보고 추정할 수도 있지만, 여기선 무조건 동작
    // 편집기가 주로 수정 화면에서 문제라, 아래 로직이 모든 프레임에서 안전하게 동작하도록 구성함
  }

  // 🔗 GitHub map.json RAW 주소
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
    if (!IS_TOP) return; // 토스트는 탑에서만
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
      console.log("[FFXIVKR IMG] map.json OK:", Object.keys(KEYMAP).length);
    } else {
      console.warn("[FFXIVKR IMG] map.json HTTP 실패:", res.status);
    }
  } catch (e) {
    console.warn("[FFXIVKR IMG] map.json 오류:", e);
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
    // 대소문자 섞여도 대응
    return str.replace(/<img[^>]*\ssrc=['"]([^'"]+)['"][^>]*>/gi, (m, src) => {
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

  /* ========== 커서 복구 ========== */
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
          if (before !== after) { applyChangeToNode(ed.el, after); changedCount++; }
        } else if (ed.type === "contenteditable") {
          const before = ed.el.innerHTML;
          const after = replaceMarkersInString(before);
          if (before !== after) { applyChangeToNode(ed.el, after); changedCount++; }
        }
      } catch (e) {
        console.warn("[FFXIVKR IMG] 처리 오류:", e);
      }
    });
    if (changedCount > 0) toast(`이미지 표식 치환: ${changedCount}개 필드`);
    return changedCount > 0;
  }

  /* ========== 수정페이지: 초기 역변환 + 라이브 감시 + 재보정 ========== */
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
      if (main?.el) placeCaretEnd(main.el);
      console.log("[FFXIVKR IMG] 수정 역변환:", changed);
    }
  }

  function observeModifyEditors() {
    const editors = getAllEditors();
    const opts = { childList: true, subtree: true, characterData: true };
    editors.forEach((ed) => {
      const root =
        ed.el.closest?.("form") ||
        ed.doc?.body ||
        document.body;
      if (!root) return;
      const obs = new MutationObserver(() => {
        // 바뀔 때마다 해당 에디터만 재정리
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
      });
      try { obs.observe(root, opts); } catch {}
    });

    // 지연 주입 대비: 0ms / 300ms / 1000ms / 2000ms에 재보정
    [0, 300, 1000, 2000].forEach((ms) => setTimeout(convertImgsToMarkersOnce, ms));
  }

  document.addEventListener("DOMContentLoaded", () => {
    // 수정 페이지여부는 탑 프레임에서만 확실하지만, 하위 프레임에서도 역변환을 시도해도 안전함
    observeModifyEditors();
  });

  /* ========== 제출 직전: 표식 → 이미지 ========== */
  window.addEventListener("submit", () => {
    const okAll = processAllEditors();
    console.log("[FFXIVKR IMG] submit 변환:", okAll);
  }, true);

  /* ========== 버튼: 수정 화면에서는 안내만, 글쓰기에서는 수동 변환 허용 ========== */
  function mountButton() {
    if (!IS_TOP) return; // 버튼은 탑에서만
    if (document.getElementById("ffxivkr-btn")) return;
    const btn = document.createElement("button");
    const isModifyUI = topPageInfoFallback().isModify;
    btn.id = "ffxivkr-btn";
    btn.textContent = isModifyUI ? "ℹ️ 수정: 제출 시 자동 변환" : "🔄 <이미지:키> 변환";
    Object.assign(btn.style, {
      position: "fixed",
      right: "16px",
      bottom: "16px",
      zIndex: 2147483647,
      padding: "10px 12px",
      borderRadius: "10px",
      border: "none",
      cursor: "pointer",
      background: isModifyUI ? "#6b7280" : "#3b82f6",
      color: "#fff",
      fontWeight: "600",
      boxShadow: "0 8px 16px rgba(0,0,0,.25)"
    });
    btn.title = isModifyUI
      ? "수정 화면은 편집 편의를 위해 표식을 유지합니다. 저장 시 자동 변환됩니다."
      : "본문의 <이미지:키워드> 표식을 <img> 태그로 변환";
    btn.addEventListener("click", () => {
      if (isModifyUI) {
        toast("수정 화면에서는 제출 시 자동 변환됩니다 (편집 중에는 표식 유지).");
      } else {
        const okAll = processAllEditors();
        btn.textContent = okAll ? "✅ 변환 완료" : "ℹ️ 변환할 항목 없음";
        setTimeout(() => (btn.textContent = "🔄 <이미지:키> 변환"), 1200);
      }
    });
    document.body.appendChild(btn);
  }

  document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", mountButton)
    : mountButton();
})();
