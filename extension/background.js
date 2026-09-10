/* Zoomaid — Chrome 拡張のサービスワーカー
 *
 * やることは 1 つだけ。Mermaid のコードを base64url にして
 * index.html#c=… を開く。ビューア本体は CLI (bin/zoomaid) と同じものを共有している。
 */
'use strict';

var VIEWER = chrome.runtime.getURL('index.html');
var TAB_KEY = 'viewerTabId';
var MENU_ID = 'zoomaid-open-selection';

/* ============ ビューアを開く ============ */

// bin/zoomaid と同じ受け渡し形式（UTF-8 → base64url）
function encode(text){
  var bytes = new TextEncoder().encode(text), bin = '';
  for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function hashFor(code, name){
  if (!code || !code.trim()) return '';
  var h = '#c=' + encode(code.trim());
  if (name) h += '&n=' + encodeURIComponent(name.slice(0, 60));
  return h;
}

// 開きっぱなしのタブがあれば差し替える（zoomaid を撃ち直したときと同じ挙動）
async function openViewer(hash){
  var url = VIEWER + hash;
  var stored = await chrome.storage.session.get(TAB_KEY);
  var id = stored[TAB_KEY];
  if (id != null){
    try {
      var tab = await chrome.tabs.get(id);
      await chrome.tabs.update(id, { url: url, active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      return;
    } catch (e){ /* 閉じられていた。新しく開く */ }
  }
  var created = await chrome.tabs.create({ url: url });
  await chrome.storage.session.set({ [TAB_KEY]: created.id });
}

chrome.tabs.onRemoved.addListener(async function(tabId){
  var stored = await chrome.storage.session.get(TAB_KEY);
  if (stored[TAB_KEY] === tabId) await chrome.storage.session.remove(TAB_KEY);
});

/* ============ ページ中の図から（content.js） ============ */

chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse){
  if (!msg || msg.type !== 'zoomaid:open') return;
  openViewer(hashFor(msg.code, msg.name));
  sendResponse({ ok: true });
});

/* ============ 選択テキストから（右クリック） ============ */

chrome.runtime.onInstalled.addListener(function(){
  chrome.contextMenus.removeAll(function(){
    chrome.contextMenus.create({
      id: MENU_ID,
      title: 'Zoomaid で開く',
      contexts: ['selection']
    });
  });
});

chrome.contextMenus.onClicked.addListener(async function(info, tab){
  if (info.menuItemId !== MENU_ID) return;

  // info.selectionText は改行が落ちることがあるので、まずページから直に取る
  // （メニューを選んだ時点で activeTab が有効になっている）
  var text = '';
  if (tab && tab.id != null){
    try {
      var res = await chrome.scripting.executeScript({
        target: { tabId: tab.id, frameIds: [info.frameId != null ? info.frameId : 0] },
        func: function(){ return String(window.getSelection()); }
      });
      if (res && res[0]) text = res[0].result || '';
    } catch (e){ /* 権限が無いページ。info にフォールバック */ }
  }
  if (!text.trim()) text = info.selectionText || '';
  if (!text.trim()) return;

  openViewer(hashFor(text, tab && tab.title));
});

/* ============ ツールバーのアイコン ============ */

// 引数なしの `zoomaid` と同じ。図は渡さず、ビューアだけを開く
chrome.action.onClicked.addListener(function(){ openViewer(''); });
