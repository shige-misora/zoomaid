(function(){
  'use strict';

  /* ============ mermaid のロード（ローカル → CDN フォールバック） ============ */
  function ensureMermaid(){
    if (window.mermaid) return Promise.resolve();
    return new Promise(function(res, rej){
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js';
      s.onload = function(){ res(); };
      s.onerror = function(){ rej(new Error('mermaid.min.js を読み込めませんでした。vendor/mermaid.min.js を配置するか、ネットワーク接続を確認してください。')); };
      document.head.appendChild(s);
    });
  }

  /* ============ 永続設定 ============ */
  var LS = 'zoomaid/v1';
  var cfg = { theme:null, wheel:'pan', pngbg:'theme', pngscale:'3', code:'', editor:false, paneW:380 };
  try { Object.assign(cfg, JSON.parse(localStorage.getItem(LS) || '{}')); } catch(e){}
  var save = (function(){
    var t = null;
    return function(){ clearTimeout(t); t = setTimeout(function(){
      try { localStorage.setItem(LS, JSON.stringify(cfg)); } catch(e){}
    }, 250); };
  })();

  var $ = function(id){ return document.getElementById(id); };
  var defaultVer = '';
  var stage = $('stage'), canvas = $('canvas'), codeEl = $('code');

  /* ============ テーマ ============ */
  var mq = window.matchMedia('(prefers-color-scheme: dark)');
  function isDark(){ return cfg.theme ? cfg.theme === 'dark' : mq.matches; }
  function applyTheme(){
    document.documentElement.dataset.theme = isDark() ? 'dark' : 'light';
    $('btnTheme').textContent = isDark() ? '☾' : '☀';
  }
  mq.addEventListener('change', function(){ if (!cfg.theme){ applyTheme(); render(); } });

  /* ============ パン / ズーム ============ */
  var scale = 1, tx = 0, ty = 0, MIN = 0.05, MAX = 40;
  var natW = 0, natH = 0;

  function apply(){
    canvas.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')';
    $('pct').textContent = Math.round(scale * 100) + '%';
  }
  function clamp(v,a,b){ return v < a ? a : v > b ? b : v; }

  function zoomAt(cx, cy, factor){
    var ns = clamp(scale * factor, MIN, MAX);
    var k = ns / scale;
    tx = cx - k * (cx - tx);
    ty = cy - k * (cy - ty);
    scale = ns;
    apply();
  }
  function zoomCenter(factor){
    var r = stage.getBoundingClientRect();
    zoomAt(r.width / 2, r.height / 2, factor);
  }
  function fit(){
    if (!natW || !natH) return;
    var r = stage.getBoundingClientRect();
    var pad = 32;
    var s = Math.min((r.width - pad) / natW, (r.height - pad) / natH);
    scale = clamp(s, MIN, 2);
    tx = (r.width - natW * scale) / 2;
    ty = (r.height - natH * scale) / 2;
    lastW = r.width; lastH = r.height;
    apply();
  }
  function actual(){
    var r = stage.getBoundingClientRect();
    var cx = r.width / 2, cy = r.height / 2;
    zoomAt(cx, cy, 1 / scale);
  }

  // deltaMode を px に正規化（Firefox は行/ページ単位で届く）
  function norm(d, mode){ return mode === 1 ? d * 16 : mode === 2 ? d * 400 : d; }

  stage.addEventListener('wheel', function(e){
    if (!natW) return;
    e.preventDefault();
    var r = stage.getBoundingClientRect();
    var cx = e.clientX - r.left, cy = e.clientY - r.top;
    var dx = norm(e.deltaX, e.deltaMode), dy = norm(e.deltaY, e.deltaMode);
    // macOS のピンチは ctrlKey 付き wheel として届く
    var wantZoom = e.ctrlKey || e.metaKey || (cfg.wheel === 'zoom' && !e.shiftKey);
    if (wantZoom){
      // トラックパッドのピンチは 1 イベントの delta が小さいのでそのまま効き、
      // マウスホイール（1 ノッチ ±100〜120）は上限で頭打ちにする
      zoomAt(cx, cy, Math.exp(-clamp(dy, -25, 25) * 0.0125));
    } else if (e.shiftKey && dx === 0){
      tx -= dy; apply();
    } else {
      tx -= dx; ty -= dy; apply();
    }
  }, { passive:false });

  var drag = null;
  stage.addEventListener('pointerdown', function(e){
    if (e.button !== 0 || !natW) return;
    drag = { x:e.clientX, y:e.clientY, tx:tx, ty:ty, id:e.pointerId };
    stage.setPointerCapture(e.pointerId);
    stage.classList.add('grabbing');
  });
  stage.addEventListener('pointermove', function(e){
    if (!drag || e.pointerId !== drag.id) return;
    tx = drag.tx + (e.clientX - drag.x);
    ty = drag.ty + (e.clientY - drag.y);
    apply();
  });
  function endDrag(e){
    if (!drag) return;
    try { stage.releasePointerCapture(drag.id); } catch(_){}
    drag = null;
    stage.classList.remove('grabbing');
  }
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  stage.addEventListener('dblclick', function(e){
    if (!natW) return;
    var r = stage.getBoundingClientRect();
    zoomAt(e.clientX - r.left, e.clientY - r.top, e.altKey ? 1/1.8 : 1.8);
  });

  var fitPending = true;
  var lastW = 0, lastH = 0;

  // ステージの大きさが変わっても（ウィンドウリサイズ / エディタ開閉 / ペイン幅変更）
  // 今見ている中心をそのまま保つ
  function recenter(){
    var r = stage.getBoundingClientRect();
    if (natW && lastW && lastH && (r.width !== lastW || r.height !== lastH)){
      var cx = (lastW / 2 - tx) / scale, cy = (lastH / 2 - ty) / scale;
      tx = r.width / 2 - cx * scale;
      ty = r.height / 2 - cy * scale;
      apply();
    }
    lastW = r.width; lastH = r.height;
  }
  if (window.ResizeObserver) new ResizeObserver(recenter).observe(stage);
  else window.addEventListener('resize', recenter);

  /* ============ コード抽出 ============ */
  // Mermaid の図種キーワードで始まっているか（言語指定なしのコードブロック判定用）
  var HEAD = /^\s*(?:%%[\s\S]*?%%\s*)?(?:---[\s\S]*?---\s*)?(graph|flowchart|sequenceDiagram|classDiagram(?:-v2)?|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|gitGraph|mindmap|timeline|quadrantChart|requirementDiagram|C4(?:Context|Container|Component|Dynamic|Deployment)|sankey(?:-beta)?|xychart(?:-beta)?|block(?:-beta)?|architecture(?:-beta)?|packet(?:-beta)?|radar(?:-beta)?|treemap(?:-beta)?|kanban|zenuml|info)\b/i;
  function looksMermaid(s){ return HEAD.test(s); }

  function extractBlocks(text){
    var out = [], m;
    // 1) ```mermaid で明示されたブロック
    var re = /^[ \t]*(?:```|~~~)[ \t]*mermaid\b[^\n]*\n([\s\S]*?)^[ \t]*(?:```|~~~)[ \t]*$/gim;
    while ((m = re.exec(text))) out.push(m[1].trim());
    if (out.length) return out;
    // 2) 言語指定なしのブロックのうち、Mermaid に見えるものだけ
    var re2 = /^[ \t]*(?:```|~~~)[^\n]*\n([\s\S]*?)^[ \t]*(?:```|~~~)[ \t]*$/gm;
    while ((m = re2.exec(text))) { var b = m[1].trim(); if (looksMermaid(b)) out.push(b); }
    if (out.length) return out;
    // 3) 全体を Mermaid コードとみなす
    return [text.trim()];
  }

  var blocks = [], idx = 0;

  function load(text, opts){
    opts = opts || {};
    var b = extractBlocks(String(text || '')).filter(function(s){ return s.length; });
    if (!b.length){ toast('空のテキストです'); return; }
    blocks = b; idx = 0;
    fitPending = true;
    syncPager();
    setCode(blocks[0]);
    render();
    if (opts.msg) toast(opts.msg);
  }
  function setCode(t){ codeEl.value = t; cfg.code = t; save(); }
  function syncPager(){
    var p = $('pager');
    p.hidden = blocks.length < 2;
    $('blockCount').textContent = (idx + 1) + '/' + blocks.length;
  }
  function goBlock(d){
    if (blocks.length < 2) return;
    idx = (idx + d + blocks.length) % blocks.length;
    syncPager(); fitPending = true;
    setCode(blocks[idx]); render();
  }

  /* ============ レンダリング ============ */
  var seq = 0, rendering = false, queued = false;

  function mermaidConfig(over){
    var base = {
      startOnLoad: false,
      securityLevel: 'strict',
      theme: isDark() ? 'dark' : 'default',
      fontFamily: '-apple-system,BlinkMacSystemFont,"Hiragino Sans","Noto Sans JP","Segoe UI",Meiryo,sans-serif',
      flowchart: { htmlLabels: true, useMaxWidth: false, curve: 'basis' },
      sequence: { useMaxWidth: false },
      gantt: { useMaxWidth: false },
      er: { useMaxWidth: false },
      journey: { useMaxWidth: false },
      class: { useMaxWidth: false },
      state: { useMaxWidth: false },
      pie: { useMaxWidth: false },
      mindmap: { useMaxWidth: false }
    };
    if (over) for (var k in over) base[k] = over[k];
    return base;
  }

  function showError(msg){
    $('errorMsg').textContent = msg;
    $('error').hidden = false;
  }
  function clearError(){ $('error').hidden = true; }

  async function render(){
    if (rendering){ queued = true; return; }
    var src = codeEl.value.trim();
    if (!src){
      canvas.innerHTML = ''; natW = natH = 0;
      $('empty').hidden = false; clearError();
      return;
    }
    rendering = true;
    try {
      await ensureMermaid();
      mermaid.initialize(mermaidConfig());
      var id = 'mv-' + (++seq);
      var res = await mermaid.render(id, src);
      canvas.innerHTML = res.svg;
      var svg = canvas.querySelector('svg');
      if (svg){
        var vb = svg.viewBox && svg.viewBox.baseVal;
        natW = (vb && vb.width) || svg.getBoundingClientRect().width || 800;
        natH = (vb && vb.height) || svg.getBoundingClientRect().height || 600;
        svg.removeAttribute('width'); svg.removeAttribute('height');
        svg.style.width = natW + 'px';
        svg.style.height = natH + 'px';
        svg.style.maxWidth = 'none';
      }
      $('empty').hidden = true;
      clearError();
      if (fitPending){ fit(); fitPending = false; } else { apply(); }
      if (res.bindFunctions) try { res.bindFunctions(canvas); } catch(_){}
    } catch (err){
      // mermaid が差し込むエラー用 DOM を掃除
      var junk = document.getElementById('dmermaid-' + seq) || document.getElementById('mv-' + seq);
      if (junk && junk.parentNode === document.body) junk.remove();
      if (!looksMermaid(src)){
        showError('Mermaid の図が見つかりませんでした。\n```mermaid で囲まれたブロック、または Mermaid のコードそのものを渡してください。');
      } else {
        showError((err && err.message) ? err.message : String(err));
      }
    } finally {
      rendering = false;
      if (queued){ queued = false; render(); }
    }
  }

  /* ============ PNG 書き出し ============ */
  async function exportPng(){
    var src = codeEl.value.trim();
    if (!src){ toast('図がありません'); return; }
    var btn = $('btnPng');
    btn.disabled = true; btn.textContent = '書き出し中…';
    try {
      await ensureMermaid();
      // foreignObject は canvas に描けないブラウザがあるため、書き出し用に SVG テキストラベルで再描画
      mermaid.initialize(mermaidConfig({
        htmlLabels: false,
        flowchart: { htmlLabels: false, useMaxWidth: false, curve: 'basis' },
        class: { htmlLabels: false, useMaxWidth: false }
      }));
      var res = await mermaid.render('mv-export-' + (++seq), src);
      mermaid.initialize(mermaidConfig());

      var doc = new DOMParser().parseFromString(res.svg, 'image/svg+xml');
      var svg = doc.documentElement;
      var vb = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
      var w = vb.length === 4 && vb[2] ? vb[2] : parseFloat(svg.getAttribute('width')) || 800;
      var h = vb.length === 4 && vb[3] ? vb[3] : parseFloat(svg.getAttribute('height')) || 600;
      svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      svg.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
      svg.setAttribute('width', w);
      svg.setAttribute('height', h);
      svg.style.maxWidth = 'none';

      var mul = parseFloat(cfg.pngscale) || 3;
      mul = Math.min(mul, 16000 / Math.max(w, h));   // canvas 上限対策
      var cw = Math.max(1, Math.round(w * mul)), ch = Math.max(1, Math.round(h * mul));

      var svgText = new XMLSerializer().serializeToString(svg);
      var url = URL.createObjectURL(new Blob([svgText], { type:'image/svg+xml;charset=utf-8' }));

      var img = await new Promise(function(resolve, reject){
        var i = new Image();
        i.onload = function(){ resolve(i); };
        i.onerror = function(){ reject(new Error('SVG を画像化できませんでした')); };
        i.src = url;
      });

      var cv = document.createElement('canvas');
      cv.width = cw; cv.height = ch;
      var ctx = cv.getContext('2d');
      if (cfg.pngbg !== 'none'){
        ctx.fillStyle = cfg.pngbg === 'white' ? '#ffffff' : (isDark() ? '#0d1117' : '#ffffff');
        ctx.fillRect(0, 0, cw, ch);
      }
      ctx.drawImage(img, 0, 0, cw, ch);
      URL.revokeObjectURL(url);

      var blob = await new Promise(function(r){ cv.toBlob(r, 'image/png'); });
      var d = new Date(), p = function(n){ return String(n).padStart(2, '0'); };
      var name = 'mermaid-' + d.getFullYear() + p(d.getMonth()+1) + p(d.getDate()) + '-' +
                 p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + '.png';
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function(){ URL.revokeObjectURL(a.href); }, 4000);
      toast(cw + '×' + ch + 'px で保存しました');
    } catch (err){
      showError('PNG 書き出しに失敗: ' + ((err && err.message) || err));
    } finally {
      btn.disabled = false; btn.textContent = 'PNG保存';
    }
  }

  /* ============ トースト ============ */
  var toastT = null;
  function toast(msg){
    var t = $('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(function(){ t.classList.remove('show'); }, 2200);
  }

  /* ============ URL ハッシュ経由の受け渡し（zoomaid コマンド用） ============ */
  // file:///…/index.html#c=<base64url(UTF-8)>&n=<表示名>
  function decodeHash(){
    var h = location.hash || '';
    var mc = h.match(/[#&]c=([A-Za-z0-9\-_]+)/);
    if (!mc) return null;
    try {
      var b = mc[1].replace(/-/g, '+').replace(/_/g, '/');
      while (b.length % 4) b += '=';
      var bin = atob(b), arr = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      var text = new TextDecoder('utf-8').decode(arr);
      var mn = h.match(/[#&]n=([^&]*)/);
      return { text: text, name: mn ? decodeURIComponent(mn[1]) : null };
    } catch (e){ return null; }
  }
  function applyHash(announce){
    var d = decodeHash();
    if (!d || !d.text.trim()) return false;
    load(d.text, announce ? { msg: d.name ? d.name + ' を読み込みました' : '読み込みました' } : {});
    if (d.name) $('ver').textContent = d.name;
    return true;
  }
  // 開きっぱなしのタブに zoomaid を撃ち直したときも差し替わるように
  window.addEventListener('hashchange', function(){ applyHash(true); });

  /* ============ 入力 ============ */
  document.addEventListener('paste', function(e){
    if (e.target === codeEl) return;             // エディタ内は通常の貼り付け
    var text = e.clipboardData && e.clipboardData.getData('text/plain');
    if (!text || !text.trim()) return;
    e.preventDefault();
    load(text, { msg:'読み込みました' });
  });

  $('btnRead').addEventListener('click', async function(){
    try {
      var text = await navigator.clipboard.readText();
      if (text && text.trim()) load(text, { msg:'読み込みました' });
      else toast('クリップボードが空です');
    } catch (e){
      toast('直接読み取れませんでした。⌘V で貼り付けてください');
    }
  });

  ['dragenter','dragover'].forEach(function(ev){
    window.addEventListener(ev, function(e){ e.preventDefault(); document.body.classList.add('dragging'); });
  });
  ['dragleave','drop'].forEach(function(ev){
    window.addEventListener(ev, function(e){
      e.preventDefault();
      if (ev === 'drop' || e.relatedTarget === null) document.body.classList.remove('dragging');
    });
  });
  window.addEventListener('drop', function(e){
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    var r = new FileReader();
    r.onload = function(){ load(r.result, { msg: f.name + ' を読み込みました' }); };
    r.readAsText(f);
  });

  var codeT = null;
  codeEl.addEventListener('input', function(){
    cfg.code = codeEl.value; save();
    if (blocks.length) blocks[idx] = codeEl.value;
    clearTimeout(codeT);
    codeT = setTimeout(render, 300);
  });
  codeEl.addEventListener('keydown', function(e){
    if (e.key === 'Tab'){
      e.preventDefault();
      var s = codeEl.selectionStart, en = codeEl.selectionEnd;
      codeEl.setRangeText('  ', s, en, 'end');
      codeEl.dispatchEvent(new Event('input'));
    }
  });

  /* ============ ショートカット ============ */
  document.addEventListener('keydown', function(e){
    var inEditor = e.target === codeEl;
    var mod = e.metaKey || e.ctrlKey;

    if (e.key === 'Escape'){ if (menuOpen()) closeMenu(); else if (!$('editorPane').hidden) toggleEditor(false); return; }
    if (mod && (e.key === '=' || e.key === '+')){ e.preventDefault(); zoomCenter(1.25); return; }
    if (mod && e.key === '-'){ e.preventDefault(); zoomCenter(1/1.25); return; }
    if (mod && e.key === '0'){ e.preventDefault(); fit(); return; }
    if (mod && e.key.toLowerCase() === 's'){ e.preventDefault(); exportPng(); return; }
    if (inEditor || mod) return;

    switch (e.key){
      case '+': case '=': zoomCenter(1.25); break;
      case '-': zoomCenter(1/1.25); break;
      case '0': case 'f': case 'F': fit(); break;
      case '1': actual(); break;
      case 'c': case 'C': clearAll(true); break;
      case 't': case 'T': cycleTheme(); break;
      case 'e': case 'E': toggleEditor(); break;
      case 's': case 'S': exportPng(); break;
      case 'ArrowLeft': if (blocks.length > 1){ e.preventDefault(); goBlock(-1); } break;
      case 'ArrowRight': if (blocks.length > 1){ e.preventDefault(); goBlock(1); } break;
    }
  });

  /* ============ クリア（初期化） ============ */
  function clearAll(announce){
    blocks = []; idx = 0; syncPager();
    codeEl.value = '';
    cfg.code = ''; save();
    canvas.innerHTML = '';
    natW = natH = 0;
    scale = 1; tx = 0; ty = 0; apply();
    fitPending = true;
    clearError();
    $('empty').hidden = false;
    $('ver').textContent = defaultVer;
    // ハッシュを消しておかないと、リロードで同じ図が戻ってきてしまう
    if (location.hash){
      if (window.history && history.replaceState) history.replaceState(null, '', location.pathname + location.search);
      else location.hash = '';
    }
    if (announce) toast('クリアしました');
  }

  /* ============ UI 配線 ============ */
  function cycleTheme(){
    cfg.theme = isDark() ? 'light' : 'dark';
    save(); applyTheme(); render();
  }
  function toggleEditor(force){
    var pane = $('editorPane'), sp = $('split');
    var show = (force === undefined) ? pane.hidden : force;
    pane.hidden = !show; sp.hidden = !show;
    $('btnEditor').classList.toggle('on', show);
    cfg.editor = show; save();
    if (show) codeEl.focus();
  }

  $('btnClear').addEventListener('click', function(){ clearAll(true); });
  $('btnTheme').addEventListener('click', cycleTheme);
  $('btnEditor').addEventListener('click', function(){ toggleEditor(); });
  $('btnPng').addEventListener('click', exportPng);
  $('zoomIn').addEventListener('click', function(){ zoomCenter(1.25); });
  $('zoomOut').addEventListener('click', function(){ zoomCenter(1/1.25); });
  $('btnFit').addEventListener('click', fit);
  $('pct').addEventListener('click', actual);
  $('prevBlock').addEventListener('click', function(){ goBlock(-1); });
  $('nextBlock').addEventListener('click', function(){ goBlock(1); });

  // 設定メニュー
  function menuOpen(){ return !$('menu').hidden; }
  function closeMenu(){ $('menu').hidden = true; $('btnGear').classList.remove('on'); }
  $('btnGear').addEventListener('click', function(e){
    e.stopPropagation();
    $('menu').hidden = menuOpen();
    $('btnGear').classList.toggle('on', menuOpen());
  });
  document.addEventListener('click', function(e){
    if (menuOpen() && !$('menu').contains(e.target)) closeMenu();
  });
  var GROUP = { wheel:'wheel', pngbg:'pngbg', pngscale:'pngscale' };
  Array.prototype.forEach.call(document.querySelectorAll('.seg'), function(seg){
    var g = seg.dataset.group;
    seg.addEventListener('click', function(e){
      var b = e.target.closest('button'); if (!b) return;
      cfg[GROUP[g]] = b.dataset.val; save(); syncSeg();
    });
  });
  function syncSeg(){
    Array.prototype.forEach.call(document.querySelectorAll('.seg'), function(seg){
      var cur = cfg[GROUP[seg.dataset.group]];
      Array.prototype.forEach.call(seg.querySelectorAll('button'), function(b){
        b.classList.toggle('on', b.dataset.val === String(cur));
      });
    });
  }

  // ペイン幅ドラッグ
  (function(){
    var sp = $('split'), dragging = false;
    sp.addEventListener('pointerdown', function(e){
      dragging = true; sp.setPointerCapture(e.pointerId); e.preventDefault();
    });
    sp.addEventListener('pointermove', function(e){
      if (!dragging) return;
      var w = clamp(e.clientX, 220, window.innerWidth * 0.7);
      $('editorPane').style.width = w + 'px';
      cfg.paneW = w; save();
    });
    sp.addEventListener('pointerup', function(e){
      dragging = false;
      try { sp.releasePointerCapture(e.pointerId); } catch(_){}
    });
  })();

  /* ============ 起動 ============ */
  applyTheme();
  syncSeg();
  $('editorPane').style.width = (cfg.paneW || 380) + 'px';
  if (cfg.editor) toggleEditor(true);

  ensureMermaid().then(function(){
    try {
      var v = (typeof mermaid.version === 'function') ? mermaid.version()
            : (mermaid.mermaidAPI && mermaid.mermaidAPI.defaultConfig && mermaid.mermaidAPI.defaultConfig.version) || '11';
      $('ver').textContent = 'mermaid ' + v;
    } catch(_){ $('ver').textContent = 'mermaid 11'; }
    defaultVer = $('ver').textContent;
    if (applyHash(false)) return;
    if (cfg.code && cfg.code.trim()){
      blocks = [cfg.code]; idx = 0; syncPager();
      codeEl.value = cfg.code;
      fitPending = true;
      render();
    }
  }).catch(function(err){
    $('empty').hidden = true;
    showError(err.message);
  });
})();
