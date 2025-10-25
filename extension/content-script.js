(async () => {
  // 🔹 map.json 주소 (당신의 GitHub ID에 맞게 수정)
  const MAP_URL = "https://raw.githubusercontent.com/YourID/dcinside-project-ffxivkrm/main/map.json";

  // 🔹 예비 기본값 (map.json 로드 실패 시 대비)
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

  // ===============================

  function findEditorArea() {
    // 글쓰기 페이지의 본문 textarea
    const ta = document.querySelector('textarea[name="memo"], textarea[name="content"], textarea#memo, textarea#content');
    if (ta) return { type: "textarea", el: ta };
    const ce = document.querySelector('[contenteditable="true"]');
    if (ce) return { type: "contenteditable", el: ce };
    const iframes = Array.from(document.querySelectorAll("iframe"));
    for (const ifr of iframes) {
      try {
        const doc = ifr.contentDocument;
        if (!doc) continue;
        const innerCE = doc.querySelector('[contenteditable="true"]');
        if (innerCE) return { type: "iframe-contenteditable", el: innerCE, doc };
        const innerTA = doc.querySelector("textarea");
        if (innerTA) return { type: "iframe-textarea", el: innerTA, doc };
      } catch {}
    }
    return null;
  }

  function replaceMarkersInText(text) {
    return text.replace(/<이미지:([^>]+)>/g, (m, keyRaw) => {
      const key = keyRaw.trim();
      const url = KEYMAP[key];
      if (!url) return m;
      return `<img src="${url.replace(/"/g, "&quot;")}" alt="${key}" />`;
    });
  }

  function replaceMarkersInHTML(html) {
    return html.replace(/<이미지:([^>]+)>/g, (m, keyRaw) => {
      const key = keyRaw.trim();
      const url = KEYMAP[key];
      if (!url) return m;
      return `<img src="${url.replace(/"/g, "&quot;")}" alt="${key}" />`;
    });
  }

  function processEditorNow(editor) {
    try {
      if (!editor) editor = findEditorArea();
      if (!editor) return false;

      if (editor.type === "textarea" || editor.type === "iframe-textarea") {
        const ta = editor.el;
        const before = ta.value;
        const after = replaceMarkersInText(before);
        if (before !== after) {
          ta.value = after;
          ta.dispatchEvent(new Event("input", { bubbles: true }));
          ta.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        }
      } else if (editor.type === "contenteditable" || editor.type === "iframe-contenteditable") {
        const el = editor.el;
        const before = el.innerHTML;
        const after = replaceMarkersInHTML(before);
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
    processEditorNow(findEditorArea());
  }, true);

  // 수동 변환 버튼
  function mountButton() {
    if (document.getElementById("ffxivkr-btn")) return;
    const btn = document.createElement("button");
    btn.id = "ffxivkr-btn";
    btn.textContent = "🔄 <이미지:키> 변환";
    Object.assign(btn.style, {
      position: "fixed",
      right: "16px",
      bottom: "16px",
      zIndex: 999999,
      padding: "10px 12px",
      borderRadius: "10px",
      border: "none",
      cursor: "pointer",
      background: "#3b82f6",
      color: "#fff",
      fontWeight: "600",
      boxShadow: "0 6px 16px rgba(0,0,0,.25)"
    });
    btn.addEventListener("click", () => {
      const changed = processEditorNow(findEditorArea());
      btn.textContent = changed ? "✅ 변환 완료" : "ℹ️ 변환할 항목 없음";
      setTimeout(() => (btn.textContent = "🔄 <이미지:키> 변환"), 1500);
    });
    document.body.appendChild(btn);
  }

  document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", mountButton)
    : mountButton();
})();
