(async () => {
  /* ===== 대상 갤 제한 (탑 프레임 엄격, 하위 프레임은 허용) ===== */
  const TARGET_GALLERY_ID = "ffxivkr";
  const IS_TOP = window.top === window;

  function topPageInfo() {
    try {
      const u = new URL(location.href);
      const isWrite  = /\/mgallery\/board\/write\//i.test(u.pathname);
      const isModify = /\/mgallery\/board\/modify\//i.test(u.pathname);
      const id = u.searchParams.get("id");
      return { isWrite, isModify, ok: id === TARGET_GALLERY_ID && (isWrite || isModify) };
    } catch {
      return { isWrite: false, isModify: false, ok: false };
    }
  }
  const TOP = IS_TOP ? topPageInfo() : { isWrite: false, isModify: false, ok: true };
  if (IS_TOP && !TOP.ok) return;

  /* ===== 설정 ===== */
  const MAP_URL = "https://raw.githubusercontent.com/AnShirley322/dcinside-project-ffxivkrm/main/map.json";

  /* ===== 유틸 ===== */
  const ZW = "\u200B";
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
  function normUrl(u) { try { return decodeURIComponent(u).replace(/"/g, "&quot;"); } catch { return u; } }

  /* ===== map.json 로드 및 역맵 ===== */
  let KEYMAP = {};
  let REVMAP = {};
  try {
    const r = await fetch(MAP_URL, { cache: "no-cache" });
    if (r.ok) {
      const raw = await r.json();
      KEYMAP = normalizeKeymap(raw);
      for (const [k, url] of Object.entries(KEYMAP)) REVMAP[normUrl(url)] = k;
      console.log("[FFXIVKR IMG] map.json OK:", Object.keys(KEYMAP).length);
    }
  } catch {}

  /* ===== 에디터 찾기 (모든 프레임) ===== */
  function getAllEditors(rootDoc) {
    const arr = [];
    const doc = rootDoc || document;
    doc.querySelectorAll("textarea").forEach(el => arr.push({ type: "ta", el, doc }));
    doc.querySelectorAll('[contenteditable="true"]').forEach(el => arr.push({ type: "ce", el, doc }));
    doc.querySelectorAll("iframe").forEach(ifr => {
      try { if (ifr.contentDocument) arr.push(...getAllEditors(ifr.contentDocument)); } catch {}
    });
    return arr;
  }
  function focusEnd(node) {
    try {
      node.focus();
      const d = node.ownerDocument, w = d.defaultView || window;
      if ("value" in node) {
        const L = node.value.length;
        node.setSelectionRange(L, L);
      } else {
        const rng = d.createRange();
        rng.selectNodeContents(node);
        rng.collapse(false);
        const sel = w.getSelection(); sel.removeAllRanges(); sel.addRange(rng);
      }
    } catch {}
  }

  /* ===== 표식 <-> 이미지 변환 (문자열 방식: 제출 시 사용) ===== */
  const IMG_MARK_RE = new RegExp(
    "(?:&lt;|&amp;lt;|[<\\uFF1C\\u3008])[\\u200B\\u200C\\u200D\\uFEFF]*\\s*이미지\\s*:\\s*([" + "“”'`" + "]?)[\\u200B\\u200C\\u200D\\uFEFF]*\\s*([\\s\\S]*?)\\s*[\\u200B\\u200C\\u200D\\uFEFF]*\\1\\s*[\\u200B\\u200C\\u200D\\uFEFF]*(?:&gt;|&amp;gt;|[>\\uFF1E\\u3009])",
    "gi"
  );
  function markersToImgs(str) {
    return str.replace(IMG_MARK_RE, (m, _q, rawKey) => {
      const key = cleanKey(rawKey);
      const url = KEYMAP[key];
      return url ? `<img src="${url.replace(/"/g, "&quot;")}" alt="${key}" />` : m;
    });
  }

  /* ===== DOM 레벨 강제 역변환 (수정 페이지에서 커서 확보용) ===== */
  function imgNodeToMarkerNode(doc, imgEl) {
    const src = imgEl.getAttribute("src") || "";
    const key = REVMAP[normUrl(src)];
    const text = key ? `${ZW}<이미지:${key}>${ZW}` : `${ZW}[IMG]${ZW}`; // 키를 못 찾으면 플레이스홀더
    // 텍스트 노드로 교체 (HTML 해석 금지)
    const tn = doc.createTextNode(text);
    imgEl.replaceWith(tn);
    // 이미지 사이 간격 보장
    const parent = tn.parentNode;
    if (parent && parent.nodeType === 1) {
      // 연속 텍스트 사이 <br> 삽입(편집기 커서 안정)
      const next = tn.nextSibling;
      if (next && next.nodeType === 3) {
        parent.insertBefore(doc.createElement("br"), next);
      }
    }
  }
  function forceDomReverseInEditor(ed) {
    const doc = ed.doc || document;
    if (ed.type === "ce") {
      ed.el.querySelectorAll("img").forEach(img => imgNodeToMarkerNode(doc, img));
      // 이미지 태그가 아예 사라졌을 때도 마지막에 줄 하나 보장
      if (!ed.el.innerHTML.match(/<br>|<p>|<div>/i)) {
        ed.el.appendChild(doc.createElement("br"));
      }
    } else if (ed.type === "ta") {
      // textarea는 문자열 치환으로 충분
      let v = ed.el.value || "";
      // 안전: 실제 <img ...>가 원문에 들어있다면 엔티티화
      if (/<img[\s\S]*?>/i.test(v)) v = v.replace(/<img[\s\S]*?>/gi, "[IMG]");
      // &lt;img…&gt; 형태도 [IMG]로
      v = v.replace(/&lt;img[\s\S]*?&gt;/gi, "[IMG]");
      ed.el.value = v;
    }
  }

  /* ===== 수정 화면용 라이브 감시 ===== */
  function observeAndReverse() {
    const eds = getAllEditors();
    // 초기 강제 역변환
    eds.forEach(ed => forceDomReverseInEditor(ed));
    // 커서 복구
    const main = eds[0]; if (main?.el) focusEnd(main.el);

    // 감시: IMG 재삽입 즉시 텍스트로 환원
    eds.forEach(ed => {
      const root = ed.el.closest?.("form") || ed.doc?.body || document.body;
      if (!root) return;
      const obs = new MutationObserver((muts) => {
        let need = false;
        for (const m of muts) {
          for (const n of m.addedNodes || []) {
            if (n.nodeType === 1) {
              const el = /** @type {Element} */ (n);
              if (el.tagName && el.tagName.toLowerCase() === "img") { need = true; break; }
              if (el.querySelector && el.querySelector("img")) { need = true; break; }
            }
          }
          if (need) break;
        }
        if (need) {
          try { forceDomReverseInEditor(ed); focusEnd(ed.el); } catch {}
        }
      });
      try { obs.observe(root, { childList: true, subtree: true, characterData: false }); } catch {}
    });

    // 지연 주입 대비 재보정(0.2s, 0.8s, 2s, 4s)
    [200, 800, 2000, 4000].forEach(t => setTimeout(() => {
      eds.forEach(ed => { try { forceDomReverseInEditor(ed); } catch {} });
    }, t));
  }

  /* ===== 제출 직전: 표식 → 이미지 ===== */
  window.addEventListener("submit", () => {
    const eds = getAllEditors();
    eds.forEach(ed => {
      try {
        if (ed.type === "ta") {
          const before = ed.el.value || "";
          const after  = markersToImgs(before);
          if (before !== after) ed.el.value = after;
        } else if (ed.type === "ce") {
          const before = ed.el.innerHTML || "";
          const after  = markersToImgs(before);
          if (before !== after) ed.el.innerHTML = after;
        }
      } catch {}
    });
  }, true);

  /* ===== 버튼 (탑 프레임만 표시) ===== */
  function mountButton() {
    if (!IS_TOP) return;
    if (document.getElementById("ffxivkr-btn")) return;
    const btn = document.createElement("button");
    btn.id = "ffxivkr-btn";
    const isModifyUI = topPageInfo().isModify;
    btn.textContent = isModifyUI ? "ℹ️ 수정: 편집은 표식, 제출 시 자동 변환" : "🔄 <이미지:키> 변환";
    Object.assign(btn.style, {
      position: "fixed", right: "16px", bottom: "16px", zIndex: 2147483647,
      padding: "10px 12px", borderRadius: "10px", border: "none", cursor: "pointer",
      background: isModifyUI ? "#6b7280" : "#3b82f6", color: "#fff", fontWeight: "600",
      boxShadow: "0 8px 16px rgba(0,0,0,.25)"
    });
    btn.addEventListener("click", () => {
      if (isModifyUI) {
        // 수정 화면에서는 안내만 (항상 표식 유지)
        return;
      } else {
        // 글쓰기 화면 수동 미리 변환
        const eds = getAllEditors();
        let any = false;
        eds.forEach(ed => {
          try {
            if (ed.type === "ta") {
              const b = ed.el.value || "", a = markersToImgs(b);
              if (b !== a) { ed.el.value = a; any = true; }
            } else {
              const b = ed.el.innerHTML || "", a = markersToImgs(b);
              if (b !== a) { ed.el.innerHTML = a; any = true; }
            }
          } catch {}
        });
        btn.textContent = any ? "✅ 변환 완료" : "ℹ️ 변환할 항목 없음";
        setTimeout(() => (btn.textContent = "🔄 <이미지:키> 변환"), 1200);
      }
    });
    document.body.appendChild(btn);
  }

  /* ===== 시작 ===== */
  document.addEventListener("DOMContentLoaded", () => {
    mountButton();
    // 수정 화면일 가능성이 높으면 즉시 감시 시작(하위 프레임에서도 안전)
    observeAndReverse();
  });
})();
