(async () => {
  // 🔗 GitHub map.json RAW 주소
  const MAP_URL =
    "https://raw.githubusercontent.com/AnShirley322/dcinside-project-ffxivkrm/main/map.json";

  /* ========== 유틸 ========== */
  function cleanKey(s) {
    if (!s) return "";
    return s
      .replace(/[\u00A0\u200B\u200C\u200D\uFEFF]/g, "") // 숨은 공백 제거
      .replace(/\u3000/g, " ")                           // 전각공백 → 일반공백
      .replace(/[“”„‟«»‚‘’‹›"']/g, "")                  // 다양한 따옴표 제거
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

  /* ========== map.json 로드 ========== */
  let KEYMAP = {};
  try {
    const res = await fetch(MAP_URL, { cache: "no-cache" });
    if (res.ok) {
      const raw = await res.json();
      KEYMAP = normalizeKeymap(raw);
      console.log("[FFXIVKR IMG] map.json 불러오기 성공:", Object.keys(KEYMAP).length, "개 항목");
    } else {
      console.warn("[FFXIVKR IMG] map.json 불러오기 실패:", res.status);
    }
  } catch (e) {
    console.warn("[FFXIVKR IMG] map.json 불러오기 오류:", e);
  }

  /* ========== 에디터 찾기 ========== */
  function getAllEditors(rootDoc) {
    const arr = [];
    const doc = rootDoc || document;

    // textarea들 전부
    doc.querySelectorAll("textarea").forEach((ta) => {
      arr.push({ type: "textarea", el: ta, doc, where: "textarea" });
    });

    // contenteditable
    doc.querySelectorAll('[contenteditable="true"]').forEach((el) => {
      arr.push({ type: "contenteditable", el, doc, where: "contenteditable" });
    });

    // iframe 내부(동일출처에서만 접근 가능)
    doc.querySelectorAll("iframe").forEach((ifr) => {
      try {
        const idoc = ifr.contentDocument;
        if (idoc) {
          arr.push(...getAllEditors(idoc));
        }
      } catch {
        /* cross-origin이면 건너뜀 */
      }
    });

    return arr;
  }

  function findPrimaryEditor() {
    // 우선순위: memo/content 이름 → 아무 textarea → CE
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

    // iframe 내부도 탐색
    const all = getAllEditors();
    return all[0] || null;
  }

  /* ========== 패턴/치환 ========== */
  // 시작: <, ＜(FF1C), 〈(3008), &lt;, &amp;lt;
  // 끝:   >, ＞(FF1E), 〉(3009), &gt;, &amp;gt;
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

  function highlight(el) {
    try {
      const win = el?.ownerDocument?.defaultView || window;
      const HTMLElementCtor = win.HTMLElement || HTMLElement;
      const target = el instanceof HTMLElementCtor ? el : el.parentElement;
      if (!target) return;
      const old = target.style.outline;
      target.style.outline = "3px solid #22c55e";
      setTimeout(() => (target.style.outline = old), 800);
    } catch {}
  }

  function applyChangeToNode(node, nextValue) {
    if ("value" in node) {
      node.value = nextValue;
      node.dispatchEvent(new Event("input", { bubbles: true }));
      node.dispatchEvent(new Event("change", { bubbles: true }));
      node.dispatchEvent(new Event("keyup", { bubbles: true }));
    } else {
      node.innerHTML = nextValue;
    }
    highlight(node);
  }

  /* ========== 변환 실행 (모든 에디터 일괄) ========== */
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

  // 기존 단일 에디터용도 유지(버튼에서 사용)
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

  /* ========== 제출 직전 강제 치환 ========== */
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
    btn.title = "본문의 <이미지:키워드> 표식을 <img> 태그로 변환";
    btn.addEventListener("click", () => {
      // 모든 필드 일괄 치환 시도
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
