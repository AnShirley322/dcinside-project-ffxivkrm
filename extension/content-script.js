(async () => {
  const MAP_URL = "https://raw.githubusercontent.com/AnShirley322/dcinside-project-ffxivkrm/main/map.json";

  let KEYMAP = {};
  try {
    const res = await fetch(MAP_URL, { cache: "no-cache" });
    if (res.ok) {
      KEYMAP = await res.json();
      console.log("[FFXIVKR IMG] map.json 불러오기 성공:", Object.keys(KEYMAP).length, "개 항목");
    } else {
      console.warn("[FFXIVKR IMG] map.json 불러오기 실패:", res.status);
    }
  } catch (e) {
    console.warn("[FFXIVKR IMG] map.json 불러오기 오류:", e);
  }

  // ===== 에디터 찾기 보강 =====
  function findEditorArea() {
    // 1) 흔한 textarea
    const ta =
      document.querySelector('textarea[name="memo"]') ||
      document.querySelector('#memo, #content, textarea[name="content"]') ||
      document.querySelector('form[action*="write"] textarea') ||
      document.querySelector('textarea');
    if (ta) return { type: "textarea", el: ta, where: "textarea" };

    // 2) contenteditable
    const ce = document.querySelector('[contenteditable="true"]');
    if (ce) return { type: "contenteditable", el: ce, where: "contenteditable" };

    // 3) iframe 내부 (동일출처만 접근 가능)
    const iframes = Array.from(document.querySelectorAll("iframe"));
    for (const ifr of iframes) {
      try {
        const doc = ifr.contentDocument;
        if (!doc) continue;
        const innerCE = doc.querySelector('[contenteditable="true"]');
        if (innerCE) return { type: "iframe-contenteditable", el: innerCE, doc, where: "iframe CE" };
        const innerTA = doc.querySelector("textarea");
        if (innerTA) return { type: "iframe-textarea", el: innerTA, doc, where: "iframe TA" };
      } catch {}
    }
    return null;
  }

  // ===== 키 정리 =====
  function cleanKey(s) {
    if (!s) return "";
    return s
      .replace(/[\u00A0\u200B\u200C\u200D\uFEFF]/g, "") // 숨은 공백 제거
      .replace(/\u3000/g, " ")                           // 전각공백 → 일반공백
      .replace(/[“”„‟«»‚‘’‹›"']/g, "")                  // 다양한 따옴표 제거
      .trim()
      .replace(/\s+/g, " ");                             // 연속공백 1칸
  }

  // ===== <이미지:키> 패턴 (폭넓게 허용)
  // 시작: <  또는 ＜(FF1C) 또는 〈(3008) 또는 &lt; / &amp;lt;
  // 끝:   >  또는 ＞(FF1E) 또는 〉(3009) 또는 &gt;  / &amp;gt;
  const IMG_MARK_RE = /(?:(?:&amp;)?lt;|[<\uFF1C\u3008])\s*이미지\s*:\s*(["“”'`]?)\s*([\s\S]*?)\s*\1\s*(?:(?:&amp;)?gt;|[>\uFF1E\u3009])/gi;

  function replaceMarkersInString(str) {
    // 매칭 카운트(진단용)
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

  function processEditorNow(editor) {
    try {
      if (!editor) editor = findEditorArea();
      console.log("[FFXIVKR IMG] editor:", editor && editor.where);
      if (!editor) return false;

      if (editor.type === "textarea" || editor.type === "iframe-textarea") {
        const ta = editor.el;
        const before = ta.value;
        const after  = replaceMarkersInString(before);
        if (before !== after) {
          ta.value = after;
          ta.dispatchEvent(new Event("input", { bubbles: true }));
          ta.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        }
      } else if (editor.type === "contenteditable" || editor.type === "iframe-contenteditable") {
        const el = editor.el;
        const before = el.innerHTML;
        const after  = replaceMarkersInString(before);
        if (before !== after) {
          el.innerHTML = after;
          return true;
        }
      }
    } catch (e) {
      console.warn("[FFXIVKR IMG] 처리 오류:", e);
    }
    return false;
  }

  // 제출 직전 자동 변환
  window.addEventListener("submit", () => {
    const ok = processEditorNow(findEditorArea());
    console.log("[FFXIVKR IMG] submit 시 변환:", ok);
  }, true);

  // 수동 변환 버튼
  function mountButton() {
    if (document.getElementById("ffxivkr-btn")) return;
    const btn = document.createElement("button");
    btn.id = "ffxivkr-btn";
    btn.textContent = "🔄 <이미지:키> 변환";
    Object.assign(btn.style, {
      position: "fixed", right: "16px", bottom: "16px", zIndex: 999999,
      padding: "10px 12px", borderRadius: "10px", border: "none",
      cursor: "pointer", background: "#3b82f6", color: "#fff", fontWeight: "600",
      boxShadow: "0 6px 16px rgba(0,0,0,.25)"
    });
    btn.addEventListener("click", () => {
      const ok = processEditorNow(findEditorArea());
      btn.textContent = ok ? "✅ 변환 완료" : "ℹ️ 변환할 항목 없음";
      setTimeout(() => (btn.textContent = "🔄 <이미지:키> 변환"), 1200);
    });
    document.body.appendChild(btn);
  }

  document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", mountButton)
    : mountButton();
})();
