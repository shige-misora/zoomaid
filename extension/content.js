/* Zoomaid — ページ中の Mermaid 図に「拡大して読む」ボタンを出す
 *
 * ページの DOM には触らない。ホバー中の図に追従する 1 個のボタンを
 * shadow DOM に閉じて body に置くだけなので、レイアウトも CSS も汚さない。
 */
'use strict';

(function(){
  if (window.__zoomaidContent) return;
  window.__zoomaidContent = true;

  var SEL = [
    '[data-type="mermaid"]',        // GitHub（図は iframe だがソースは親に残っている）
    'pre[lang="mermaid"]',
    'code.language-mermaid',
    '.language-mermaid',
    'pre.mermaid',
    'div.mermaid'
  ].join(',');

  /* ============ 図とそのソースを見つける ============ */

  // 見つからなければ null。ソースを取り出せない図にはボタンを出さない
  // （空のビューアが開くくらいなら、何も出ないほうがまし）
  function find(el){
    if (!el || !el.closest) return null;
    var hit = el.closest(SEL);
    if (!hit) return null;

    // GitHub: 図は viewscreen の iframe で描画されるが、ソースは親に残っている。
    // ただし data-type="mermaid" は入れ子になっていて（外側の section がソースを持ち、
    // 内側の container が iframe を抱える）、内側で止まると何も取れない。登って探す。
    for (var node = hit; node; node = node.parentElement){
      if (!node.matches('[data-type="mermaid"]')) continue;
      var plain = node.querySelector('[data-plain]');
      var pre = node.querySelector('pre[lang="mermaid"]');
      var src = plain ? plain.getAttribute('data-plain') : (pre ? pre.textContent : '');
      if (src && src.trim()) return { anchor: node, code: src };
    }

    // 描画済みでソースが失われているものは対象外
    if (hit.querySelector('svg')) return null;

    var text = hit.textContent;
    return text && text.trim() ? { anchor: hit, code: text } : null;
  }

  // ビューアのヘッダに出す名前。ページタイトルは冗長になりがちなので
  // ファイル名が取れるならそちらを使う（例: README.md）
  function label(){
    var file = location.pathname.split('/').filter(Boolean).pop() || '';
    if (/\.[a-z0-9]{1,6}$/i.test(file)){
      try { return decodeURIComponent(file); } catch (e){ return file; }
    }
    return document.title.split(' · ')[0].trim() || location.hostname;
  }

  /* ============ ボタン ============ */

  var host = document.createElement('div');
  host.style.cssText = 'all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483646;';

  var root = host.attachShadow({ mode: 'open' });
  var style = document.createElement('style');
  style.textContent = [
    'button{',
    '  position:fixed;display:none;align-items:center;gap:6px;',
    '  margin:0;padding:5px 10px;border:1px solid rgba(255,255,255,.14);border-radius:7px;',
    '  font:600 12px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;',
    '  color:#e8edf5;background:#252b36;cursor:pointer;',
    '  box-shadow:0 2px 10px rgba(0,0,0,.35);opacity:.92;',
    '}',
    'button:hover{opacity:1;background:#2f3745;}',
    'button.on{display:inline-flex;}',
    'span{font-size:13px;line-height:1;}'
  ].join('\n');

  var btn = document.createElement('button');
  btn.type = 'button';
  btn.title = 'Zoomaid で拡大して読む';
  var glyph = document.createElement('span');
  glyph.textContent = '⤡';   // ⤡
  btn.appendChild(glyph);
  btn.appendChild(document.createTextNode('Zoomaid'));

  root.appendChild(style);
  root.appendChild(btn);

  function mount(){
    if (!host.isConnected && document.body) document.body.appendChild(host);
  }

  /* ============ ホバーへの追従 ============ */

  var current = null, hideT = null;

  function place(){
    if (!current) return;
    var r = current.anchor.getBoundingClientRect();
    // 画面外や潰れた要素には出さない
    if (r.width < 48 || r.height < 24 || r.bottom < 8 || r.top > window.innerHeight - 8){
      hide();
      return;
    }
    btn.style.left = Math.round(Math.max(4, r.left + 8)) + 'px';
    btn.style.top = Math.round(Math.max(4, r.top + 8)) + 'px';
  }

  function show(found){
    clearTimeout(hideT);
    mount();
    current = found;
    btn.classList.add('on');
    place();
  }

  function hide(){
    clearTimeout(hideT);
    current = null;
    btn.classList.remove('on');
  }

  document.addEventListener('mouseover', function(e){
    if (e.target === host) return;             // ボタン自身（shadow の外からは host に見える）
    var found = find(e.target);
    if (found){
      if (!current || current.anchor !== found.anchor) show(found);
      else clearTimeout(hideT);
    } else if (current){
      clearTimeout(hideT);
      hideT = setTimeout(hide, 160);           // 図とボタンの隙間を通っただけなら消さない
    }
  }, true);

  btn.addEventListener('mouseenter', function(){ clearTimeout(hideT); });
  btn.addEventListener('mouseleave', function(){
    clearTimeout(hideT);
    hideT = setTimeout(hide, 160);
  });

  window.addEventListener('scroll', place, true);
  window.addEventListener('resize', place, { passive: true });

  btn.addEventListener('click', function(e){
    e.preventDefault();
    e.stopPropagation();
    if (!current) return;
    chrome.runtime.sendMessage({
      type: 'zoomaid:open',
      code: current.code,
      name: label()
    });
    hide();
  });
})();
