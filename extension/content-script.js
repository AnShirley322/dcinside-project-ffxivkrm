(async () => {
  //
  const MAP_URL =
    "https://raw.githubusercontent.com/AnShirley322/dcinside-project-ffxivkrm/main/map.json";

  // ===== 키 정리 =====
  function cleanKey(s) {
    if (!s) return "";
    return s
      .replace(/[\u00A0\u200B\u200C\u200D\uFEFF]/g, "") // 숨은 공백 제거
      .replace(/\u3000/g, " ")                           // 전각 공백 → 일반 공백
      .replace(/[“”„‟«»‚‘’‹›"']/g, "")                  // 다양한 따옴표 제거
      .replace(/[&;]+$/g, "")                           // ★ 꼬리 &나 ; 제거
      .trim()
      .replace(/\s+/g, " ");                             // 연속 공백 1칸
  }

  // ===== map.json 키도 정규화 =====
  function normalizeKeymap(rawMap) {
    const out = {};
    for (const [k, v] of Object.entries(rawMap || {})) {
      const nk = cleanKey(k);
      if (nk) out[nk] = v;
    }
    return out;
  }

  // ===== map.json 불러오기 =====
  let KEYMAP = {};
  try {
    const res = await fetch(MAP_URL, { cache: "no-cache" });
    if (res.ok) {
      const raw = await res.json();
      KEYMAP = normalizeKeymap(raw);
      console.log(
        "[FFXIVKR IMG] map.json 불러오기 성공:",
        Object.keys(KEYMAP).length,
        "개 항목"
      );
    } else {
      console.warn("[FFXIVKR IMG] map.json 불러오기 실패:", res.status);
    }
  } catch (e) {
    console.warn("[FFXIVKR IMG] map.json 불러오기 오류:", e);
  }

  // ===== 에디터 찾기 =====
  function findEditorArea() {
    const ta =
      document.querySelector('textarea[name="memo"]') ||
      document.querySelector('#memo, #content, textarea[name="content"]') ||
      document.querySelector('form[action*="write"] textarea') ||
      document.querySelector("textarea");
    if (ta) return { type: "textarea", el: ta, where: "textarea" };

    const ce = document.querySelector('[contenteditable="true"]');
    if (ce) return { type: "contenteditable", el: ce, where: "contenteditable" };

    const iframes = Array.from(document.querySelectorAll("iframe"));
    for (const ifr of iframes) {
      try {
        const doc = ifr.contentDocument;
        if (!doc) continue;
        const innerCE = doc.querySelector('[contenteditable="true"]');
        if (innerCE)
          return { type: "iframe-contenteditable", el: innerCE, doc, where: "iframe CE" };
        const innerTA = doc.querySelector("textarea");
        if (innerTA)
          return { type: "iframe-textarea", el: innerTA, doc, where: "iframe TA" };
      } catch {
        /* cross-origin 접근 불가 무시 */
      }
    }
    return null;
  }

  // ===== <이미지:키> 패턴 (HTML 엔티티·전각 괄호 전부 허용) =====
  const IMG_MARK_RE =
    /(?:&lt;|&amp;lt;|[<\uFF1C\u3008])\s*이미지\s*:\s*(["“”'`]?)\s*([\s\S]*?)\s*\1\s*(?:&gt;|&amp;gt;|[>\uFF1E\u3009])/gi;

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

  // ===== 실제 변환 수행 =====
  function processEditorNow(editor) {
  try {
    if (!editor) editor = findEditorArea();
    console.log("[FFXIVKR IMG] editor:", editor && editor.where);
    if (!editor) return false;

    const markChanged = (el, before, after) => {
      // 변경 적용
      el.value !== undefined ? (el.value = after) : (el.innerHTML = after);

      // 진단 로그
      console.log("[FFXIVKR IMG] length:", before.length, "→", after.length);
      console.log("[FFXIVKR IMG] AFTER preview:", (after || "").slice(0, 200));

      // 시각적 하이라이트 (0.8초)
      const target = el instanceof HTMLElement ? el : el.parentElement;
      if (target) {
        const old = target.style.outline;
        target.style.outline = "3px solid #22c55e";
        setTimeout(() => (target.style.outline = old), 800);
      }
    };

    if (editor.type === "textarea" || editor.type === "iframe-textarea") {
      const ta = editor.el;
      const before = ta.value;
      const after  = replaceMarkersInString(before);
      if (before !== after) {
        markChanged(ta, before, after);
        // React/Vue 감지용 이벤트
        ta.dispatchEvent(new Event("input",  { bubbles: true }));
        ta.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }
    } else if (editor.type === "contenteditable" || editor.type === "iframe-contenteditable") {
      const el = editor.el;
      const before = el.innerHTML;
      const after  = replaceMarkersInString(before);
      if (before !== after) {
        markChanged(el, before, after);
        return true;
      }
    }
  } catch (e) {
    console.warn("[FFXIVKR IMG] 처리 오류:", e);
  }
  return false;
}

  // ===== 글 제출 시 자동 변환 =====
  window.addEventListener(
    "submit",
    () => {
      const ok = processEditorNow(findEditorArea());
      console.log("[FFXIVKR IMG] submit 시 변환:", ok);
    },
    true
  );

  // ===== 수동 변환 버튼 =====
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
    btn.title = "본문의 <이미지:키워드> 표식을 <img> 태그로 변환";
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
