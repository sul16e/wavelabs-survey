// 웨이브랩스 셀프 주차 등록 + 방문 경로 — 본체 v6(아이패드의 Userscripts 로더가 매번 이 파일을 새로 불러온다)
// 고칠 땐 이 파일만 고치고 push → 아이패드는 다음 새로고침부터 바로 반영(재설치 필요 없음)
(function () {
  function main() {
    'use strict';
    if (window.__wlParkingCore) return;   // 로더가 둘 깔려 있어도 한 번만
    window.__wlParkingCore = true;
    // ---- 설정 ----
    var SB = 'https://gsnsroacvbibljpecizu.supabase.co/rest/v1/records';
    var KEY = 'sb_publishable_eCxa1FC6BIp3L0FJwI9x5w_I-4LQ-hw';
    var CH = ['네이버 지도', '카카오맵', '인스타그램', '엘리베이터 전단', '친구·지인 소개', '기타'];
    var OUR_SHOP = '3715';          // 나이스에 등록된 우리 상점 이름에 들어 있는 글자(「Office 3715호 텔온커피」)
    var MAX_HOURS = 2;              // 기본 1시간 무료 2번 = 2시간
    var MAX_IF_OTHER = 1;           // 다른 상가에서 이미 등록한 차면 최대 1시간
    var IDLE_MS = 60000, DONE_MS = 5000, STAFF_MS = 10 * 60000;
    var LS_Q = 'wl-visit-q', LS_STAFF = 'wl-staff-until', LS_TEST = 'wl-test', LS_DRY = 'wl-dry';

    function ls(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function staffOn() { return Date.now() < +(ls(LS_STAFF) || 0); }
    var DRY = ls(LS_DRY) === '1';   // 시험용: 할인권을 실제로 누르지 않음

    // ---- 나이스 통신 엿듣기(읽기만) ----
    var listeners = [];
    var lastCarTk = null;           // 고른 차에 이미 적용된 할인권 목록
    var carPicked = false;
    (function hook() {
      var open = XMLHttpRequest.prototype.open, send = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function (m, url) { this.__wlUrl = String(url || ''); return open.apply(this, arguments); };
      XMLHttpRequest.prototype.send = function () {
        var x = this;
        x.addEventListener('loadend', function () {
          var u = x.__wlUrl || '', body = null;
          try { body = JSON.parse(x.responseText); } catch (e) {}
          if (/selectCarDiscountTk(ForUpsquare|ForIpark)?List\.do/.test(u)) { lastCarTk = (body && body.dlt_list) || []; carPicked = true; }
          listeners.slice().forEach(function (f) { try { f(u, x.status, body); } catch (e) {} });
        });
        return send.apply(this, arguments);
      };
    })();
    function waitXhr(re, ms) {
      return new Promise(function (res) {
        var done = false;
        function f(u, st, body) { if (!done && re.test(u)) { done = true; off(); res({ ok: st >= 200 && st < 300 && !(body && body.errorMsgCode), st: st, body: body }); } }
        function off() { var i = listeners.indexOf(f); if (i >= 0) listeners.splice(i, 1); }
        listeners.push(f);
        setTimeout(function () { if (!done) { done = true; off(); res({ ok: false, timeout: true }); } }, ms);
      });
    }
    function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

    // 나이스 알림창(오류 안내) 글을 읽고 닫는다
    function readAndCloseAlert() {
      var msg = '';
      document.querySelectorAll('.w2window, .w2popup_window, [class*=popup]').forEach(function (w) {
        if (!w.getClientRects().length || getComputedStyle(w).visibility === 'hidden' || w.closest('#wl-root')) return;
        var t = (w.innerText || '').replace(/\s+/g, ' ').trim();
        if (t && t.length < 300 && /확인/.test(t)) {
          msg = msg || t.replace(/^알림\s*/, '').replace(/\s*확인\s*$/, '');
          var b = [].slice.call(w.querySelectorAll('input,button,a')).filter(function (x) { return /확인/.test(x.value || x.innerText || ''); })[0];
          if (b) b.click();
        }
      });
      return msg;
    }

    // ---- 응답 저장 ----
    function send(rows) {
      return fetch(SB, { method: 'POST', headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json',
        Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify(rows) })
        .then(function (r) { if (!r.ok) throw new Error(r.status); });
    }
    function loadQ() { try { return JSON.parse(ls(LS_Q) || '[]'); } catch (e) { return []; } }
    function saveQ(q) { try { localStorage.setItem(LS_Q, JSON.stringify(q.slice(-300))); } catch (e) {} }
    function flush() { var q = loadQ(); if (q.length) send(q).then(function () { saveQ([]); }).catch(function () {}); }
    function record(ch, hours, note) {
      var now = Date.now();
      var row = { id: 'visit-' + now.toString(36) + Math.random().toString(36).slice(2, 6), kind: 'visit',
        data: { ch: ch, at: now, src: '주차', hours: hours } };
      if (note) row.data.note = String(note).slice(0, 120);
      if (ls(LS_TEST) === '1' || DRY) row.data.test = 1;
      var q = loadQ(); q.push(row); saveQ(q); flush();
    }

    // ---- 할인권 적용 ----
    function hourTicket() {
      // 사용가능 할인권 중 「1시간 · 무료」 칸(유료는 노란색)
      return [].slice.call(document.querySelectorAll('.used_ticket_box.blue')).filter(function (b) {
        return /1시간/.test(b.innerText || '') && /무료/.test(b.innerText || '') && !b.closest('[id*=usedDcTk]');
      })[0];
    }
    function countHours(list, mine) {
      var min = 0;
      (list || []).forEach(function (d) {
        var isMine = String(d.webDisShpNm || '').indexOf(OUR_SHOP) >= 0;
        if (isMine !== mine) return;
        var knd = String(d.discountTkKnd || '');
        var m = knd.charAt(0) === '1' ? Number(knd.slice(1)) : 0;   // 1로 시작 = 시간권, 뒤 숫자 = 분
        min += (m || 0) * (Number(d.useCnt) || 1);
      });
      return min / 60;
    }
    async function applyHours() {
      var mineBefore = countHours(lastCarTk, true), others = countHours(lastCarTk, false);
      var want = (others > 0 ? MAX_IF_OTHER : MAX_HOURS) - mineBefore;
      var got = 0, note = '';
      for (var i = 0; i < want; i++) {
        if (DRY) { await sleep(700); got++; continue; }
        var b = hourTicket();
        if (!b) { note = '1시간 무료 칸을 못 찾음'; break; }
        var wait = waitXhr(/useOrCancelDiscountTk\.do/, 10000);
        var refresh = waitXhr(/selectPtnrShpDisInfoList\.do/, 10000);
        b.click();
        var r = await Promise.race([wait, (async function () { for (var k = 0; k < 20; k++) { await sleep(300); var m = readAndCloseAlert(); if (m) return { ok: false, alert: m }; } return new Promise(function () {}); })()]);
        if (!r.ok) { note = r.alert || readAndCloseAlert() || (r.timeout ? '응답 없음' : '적용 안 됨'); break; }
        got++;
        await refresh; await sleep(300);
      }
      return { got: got, mineBefore: mineBefore, others: others, note: note };
    }

    // ---- 화면 ----
    var ICON = '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" style="flex:none;vertical-align:-3px"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M12 7v6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><circle cx="12" cy="16.8" r="1.4" fill="currentColor"/></svg>';
    var css = [
      'html.wl-on #mf_grp_wrap #mf_wfm_header_layoutWrap.layoutWrap::before{content:none!important;display:none!important}',
      'html.wl-on #mf_grp_wrap #contentWrap .saleWrap{padding-left:16px!important;box-sizing:border-box}',
      'html.wl-on body{padding-bottom:120px!important}',
      // ---- 브랜드 모양(10/26 사장 「나이스파크 화면도 깔끔하게 브랜드에 맞게」) — 색은 매장앱과 같은 토큰 ----
      'html.wl-on,html.wl-on body,html.wl-on #mf_grp_wrap,html.wl-on #contentWrap,html.wl-on .saleWrap,html.wl-on .saleContent{background:#F4F6F8!important}',
      'html.wl-on body,html.wl-on body *:not(svg):not(path){font-family:Pretendard,-apple-system,"Apple SD Gothic Neo",sans-serif!important}',
      'html.wl-on #contentWrap{max-width:900px;margin:0 auto!important;padding:0 16px!important;box-sizing:border-box}',
      'html.wl-on #contentWrap .saleWrap,html.wl-on #contentWrap .saleContent{padding-left:0!important;padding-right:0!important;margin-top:0!important}',
      '#wl-head{display:flex;align-items:center;gap:12px;max-width:900px;margin:0 auto;padding:20px 16px 12px;box-sizing:border-box}',
      '#wl-head img{width:40px;height:40px;border-radius:10px;flex:none}',
      '#wl-head .t1{font-size:18px;font-weight:800;color:#15212B;line-height:1.2}',
      '#wl-head .t2{font-size:13px;color:#63737F;margin-top:2px}',
      'html.wl-on #mf_wfm_body_mobileGrp{background:#fff!important;border:1px solid #E4E9ED!important;border-radius:18px!important;height:auto!important;padding:12px 12px 12px 20px!important;box-shadow:none!important;box-sizing:border-box}',
      'html.wl-on #mf_wfm_body_mobileGrp{display:none!important}',
      'html.wl-on #mf_wfm_body_carNo{flex:1;width:auto!important;background:transparent!important;border:0!important;outline:none!important;box-shadow:none!important;color:#15212B!important;font-size:34px!important;height:64px!important;font-weight:800!important;letter-spacing:8px;text-align:center;padding:0!important}',
      'html.wl-on #mf_wfm_body_carNo::placeholder{color:#AAB4BD;font-weight:600;letter-spacing:2px;font-size:24px}',
      "html.wl-on #mf_wfm_body_mobileOkBtn{position:static!important;flex:none;width:56px!important;height:56px!important;border:0!important;border-radius:14px!important;background:#20769B url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2.6' stroke-linecap='round'%3E%3Ccircle cx='11' cy='11' r='7'/%3E%3Cpath d='M20 20l-4-4'/%3E%3C/svg%3E\") center/26px no-repeat!important;font-size:0!important;color:transparent!important;text-indent:-999px;overflow:hidden;transform:none!important}",
      'html.wl-on #contentWrap .carinfoArea{margin-top:12px!important;background:#fff!important;border:1px solid #E4E9ED!important;border-radius:18px!important;overflow:hidden;box-shadow:none!important}',
      'html.wl-on.wl-nocar #contentWrap .carinfoArea{display:none!important}',
      'html.wl-on #contentWrap .car_title{background:#fff!important;border:0!important;border-bottom:1px solid #E4E9ED!important;padding:16px 20px!important;height:auto!important;min-height:0!important}',
      'html.wl-on #mf_wfm_body_mobileCarNoText{font-size:26px!important;font-weight:800!important;color:#0B5F84!important;letter-spacing:1px}',
      'html.wl-on #contentWrap .carinfoAreaIn,html.wl-on #contentWrap .carinfoAreaInner,html.wl-on #contentWrap .carinfoAreaInner_right{background:#fff!important;border:0!important;padding:0!important;margin:0!important}',
      'html.wl-on #contentWrap .carinfoArea table{width:100%!important;margin:0!important}',
      'html.wl-on #contentWrap .carinfoArea th,html.wl-on #contentWrap .carinfoArea td{padding:14px 20px!important;border:0!important;border-right:0!important;border-left:0!important;border-bottom:1px solid #E4E9ED!important;font-size:16px!important;background:#fff!important}',
      'html.wl-on #contentWrap .carinfoArea tr:last-child th,html.wl-on #contentWrap .carinfoArea tr:last-child td{border-bottom:0!important}',
      'html.wl-on #contentWrap .carinfoArea th,html.wl-on #contentWrap .carinfoArea th *{color:#63737F!important;font-weight:500!important;text-align:left}',
      'html.wl-on #contentWrap .carinfoArea th{white-space:nowrap!important;width:104px!important}',
      'html.wl-on #contentWrap .carinfoArea col:first-child{width:104px!important}',
      'html.wl-on #contentWrap .carinfoArea td,html.wl-on #contentWrap .carinfoArea td *{color:#15212B!important;font-weight:700!important}',
      'html.wl-on #contentWrap .carinfoArea th::before,html.wl-on #contentWrap .carinfoArea th label::before{content:none!important;display:none!important}',
      // 숫자판(넓은 화면 = 아이패드 가로) — 흰 카드 + 연회색 키 + 남색 OK
      'html.wl-on .saleKeypad{background:transparent!important;box-shadow:none!important;border:0!important}',
      'html.wl-on .keypadArea{background:#fff!important;border:1px solid #E4E9ED!important;border-radius:20px!important;box-shadow:none!important;padding:16px!important;box-sizing:border-box!important;height:auto!important}',
      'html.wl-on .keypadArea h4{color:#63737F!important;font-size:14px!important;font-weight:600!important;margin:0 0 8px!important}',
      'html.wl-on .keypadArea .keypad_top{width:100%!important;background:#F4F6F8!important;background-image:none!important;border:0!important;border-radius:14px!important;box-shadow:none!important;margin:0 0 12px!important}',
      'html.wl-on .keypadArea .keypad_top,html.wl-on .keypadArea .keypad_top *{color:#15212B!important;font-weight:800!important}',
      'html.wl-on .keypadArea .keypad_bottom{width:100%!important;display:grid!important;grid-template-columns:repeat(3,1fr);gap:8px;height:auto!important}',
      'html.wl-on .keypadArea .triger_box{width:auto!important;height:68px!important;margin:0!important;float:none!important;background:#F4F6F8!important;background-image:none!important;border:0!important;border-radius:14px!important;box-shadow:none!important}',
      'html.wl-on .keypadArea .triger_box:active{background:#EDF4F8!important}',
      'html.wl-on .keypadArea .triger_box input{width:100%!important;height:100%!important;background:transparent!important;background-image:none!important;border:0!important;border-radius:14px!important;box-shadow:none!important;text-shadow:none!important;color:#15212B!important;font-size:30px!important;font-weight:700!important}',
      'html.wl-on .keypadArea .triger_box,html.wl-on .keypadArea .triger_box *{outline:none!important;-webkit-tap-highlight-color:transparent}',
      'html.wl-on .keypadArea .keypad_ok{background:#20769B!important}',
      'html.wl-on .keypadArea .keypad_ok:active{background:#0B5F84!important}',
      'html.wl-on .keypadArea .keypad_ok input{color:#fff!important;font-size:24px!important;font-weight:800!important}',
      "html.wl-on .keypadArea .keypad_clear input{background:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 24 24' fill='none' stroke='%2315212B' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M21 5H9l-6 7 6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1z'/%3E%3Cpath d='M17 9l-6 6M11 9l6 6'/%3E%3C/svg%3E\") center/30px no-repeat!important;font-size:0!important;color:transparent!important;text-indent:-999px;overflow:hidden}",
      'html.wl-on .keypadArea #mf_wfm_body_keypad0Btn{grid-column:1 / span 2;grid-row:4}',
      'html.wl-on .keypadArea #mf_wfm_body_keypadDelBtn{grid-column:3;grid-row:4}',
      'html.wl-on .keypadArea #mf_wfm_body_keypadOkBtn{display:none!important}',
      // 배치: 숫자판 왼쪽 · 차량정보 오른쪽(10/26 사장)
      'html.wl-on #contentWrap .saleWrap{display:flex!important;flex-direction:row!important;align-items:flex-start;gap:16px;width:100%!important;height:auto!important}',
      'html.wl-on #contentWrap .saleKeypad{display:block!important;order:0;flex:none;position:static!important;width:320px!important;max-width:45%;margin:0!important;height:auto!important;left:auto!important;right:auto!important;top:auto!important}',
      'html.wl-on #contentWrap .saleKeypad .keypadArea{width:100%!important;position:static!important}',
      'html.wl-on #mf_grp_wrap #contentWrap .saleWrap > .saleKeypad{order:0!important}',
      'html.wl-on #mf_grp_wrap #contentWrap .saleWrap > .saleContent{order:1!important}',
      'html.wl-on #contentWrap .saleContent{order:1;flex:1;min-width:0;width:auto!important;margin:0!important;position:static!important}',
      '#wl-ph{background:#fff;border:1px solid #E4E9ED;border-radius:18px;padding:32px 20px;text-align:center;color:#63737F;font-size:16px;line-height:1.5}',
      'html.wl-on:not(.wl-nocar) #wl-ph{display:none}',
      '#wl-root{-webkit-user-select:none;user-select:none;color:#15212B}',
      '#wl-root button{border:0;touch-action:manipulation;font-family:inherit;cursor:pointer}',
      // 아래 큰 버튼 하나(안에 작게 주의 문구)
      '#wl-go{position:fixed;left:16px;right:16px;bottom:16px;z-index:2147482001;min-height:84px;border-radius:18px;background:#20769B;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:12px 16px;box-shadow:0 6px 18px rgba(21,33,43,.18)}',
      '#wl-go .m{font-size:24px;font-weight:800;line-height:1.25}',
      '#wl-go .n{font-size:13px;font-weight:500;opacity:.92;display:flex;align-items:center;gap:6px;line-height:1.3}',
      '#wl-go.wait{background:#EDEFF2;color:#63737F;box-shadow:none}',
      '#wl-go.hide{display:none}',
      // 가볍게 뜨는 팝업
      '.wl-pop{position:fixed;inset:0;z-index:2147483000;background:rgba(21,33,43,.28);display:flex;align-items:center;justify-content:center;padding:16px}',
      '.wl-pop.off{display:none}',
      '.wl-card{background:#fff;border-radius:20px;box-shadow:0 12px 36px rgba(21,33,43,.22);width:100%;max-width:520px;padding:24px;text-align:center}',
      '.wl-card .q-s{font-size:14px;color:#63737F;margin-bottom:6px}',
      '.wl-card .q{font-size:22px;font-weight:800;line-height:1.35;margin-bottom:18px}',
      '.wl-card .grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}',
      '.wl-card .grid button{min-height:56px;border-radius:14px;background:#EDF4F8;color:#0B5F84;font-size:18px;font-weight:700}',
      '.wl-card .grid button:active{background:#20769B;color:#fff}',
      '.wl-card .car{font-size:18px;color:#63737F;margin-bottom:6px}',
      '.wl-card .done{font-size:26px;font-weight:800;line-height:1.35}',
      '.wl-card .cnt{font-size:13px;color:#63737F;margin-top:14px}',
      '#wl-corner{position:fixed;top:0;left:0;width:80px;height:80px;z-index:2147483002}',
      '#wl-staff{position:fixed;top:8px;right:8px;z-index:2147483001;background:#C0392B;color:#fff;font:700 13px -apple-system,sans-serif;padding:6px 10px;border-radius:8px}'
    ].join('\n');

    function el(tag, attrs, html) {
      var e = document.createElement(tag);
      for (var k in (attrs || {})) e.setAttribute(k, attrs[k]);
      if (html != null) e.innerHTML = html;
      return e;
    }
    function home() { location.reload(); }

    function killOld() {
      // 옛 1.x 스크립트가 아이패드에 남아 있으면 그 화면(첫 질문 · 아래 줄)을 지운다
      document.querySelectorAll('#wl-ov, #wl-bar').forEach(function (x) { if (!x.closest('#wl-root')) x.remove(); });
    }
    function mask() {
      killOld();
      ['#gnbWrap', '.mobileMenu', '.mobileMypage', '#mf_wfm_body_carImgBtnId', '#mf_wfm_body_remainTkListMainBox',
        '#mf_wfm_body_usedTkListMainBox', '.keypadUsed', '#contentWrap .content_title', '#mf_wfm_body_btn_select_02',
        '#contentWrap .more_btnArea'].forEach(function (s) {
        document.querySelectorAll(s).forEach(function (x) { x.style.setProperty('display', 'none', 'important'); });
      });
      var remark = document.getElementById('mf_wfm_body_remark');
      if (remark) { var row = remark.closest('tr') || remark.parentElement; if (row) row.style.setProperty('display', 'none', 'important'); }
      var inp = document.getElementById('mf_wfm_body_carNo');
      if (inp && !inp.__wl) {
        inp.__wl = true;
        inp.setAttribute('inputmode', 'numeric'); inp.setAttribute('pattern', '[0-9]*'); inp.setAttribute('maxlength', '4');
        inp.setAttribute('placeholder', '차량번호 뒤 4자리');
      }
      var cw = document.getElementById('contentWrap');
      if (cw) ['left', 'margin-left', 'padding-left'].forEach(function (p) { cw.style.setProperty(p, '0', 'important'); });
      // 나이스가 숫자판에 order:2를 요소에 직접 넣어 둬서 여기서 덮어씀(숫자판 왼쪽 · 차량정보 오른쪽)
      var kpd = document.querySelector('#contentWrap .saleKeypad'), sct = document.querySelector('#contentWrap .saleContent');
      if (kpd) kpd.style.setProperty('order', '0', 'important');
      if (sct) sct.style.setProperty('order', '1', 'important');
      // 아이패드 폭에선 나이스가 숫자판을 숨겨서(모바일 모양) 다시 보이게
      var kpa = document.querySelector('#contentWrap .keypadArea');
      if (kpa) kpa.style.setProperty('display', 'block', 'important');
    }

    function carNoText() {
      // PC 모양(carNoText)·아이패드 모양(mobileCarNoText) 둘 다 본다
      var ids = ['mf_wfm_body_carNoText', 'mf_wfm_body_mobileCarNoText'];
      for (var i = 0; i < ids.length; i++) {
        var e = document.getElementById(ids[i]);
        var t = e ? (e.textContent || e.value || '').trim() : '';
        if (t) return t;
      }
      return '';
    }

    function build() {
      document.head.appendChild(el('style', { id: 'wl-css' }, css));
      var root = el('div', { id: 'wl-root' });
      document.body.appendChild(root);

      var corner = el('div', { id: 'wl-corner' });
      root.appendChild(corner);
      var taps = [];
      corner.addEventListener('click', function () {
        var t = Date.now(); taps = taps.filter(function (x) { return t - x < 2000; }); taps.push(t);
        if (taps.length >= 5) { try { localStorage.setItem(LS_STAFF, String(t + STAFF_MS)); } catch (e) {} location.reload(); }
      });

      if (staffOn()) {
        root.appendChild(el('div', { id: 'wl-staff' }, '직원 모드 · 10분 뒤 손님 화면으로'));
        setTimeout(home, Math.max(1000, +(ls(LS_STAFF) || 0) - Date.now()));
        return;
      }
      document.documentElement.classList.add('wl-on');
      document.documentElement.classList.add('wl-nocar');
      var font = el('link', { rel: 'stylesheet', href: 'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css' });
      document.head.appendChild(font);
      var head = el('div', { id: 'wl-head' }, '<img src="https://sul16e.github.io/wavelabs-survey/recipe/logo.jpg" alt=""><div><div class="t1">웨이브랩스 37F</div><div class="t2">셀프 주차 등록</div></div>');
      var cwTop = document.getElementById('contentWrap');
      if (cwTop && cwTop.parentNode) cwTop.parentNode.insertBefore(head, cwTop); else root.appendChild(head);
      mask(); setInterval(mask, 500);
      var ph = el('div', { id: 'wl-ph' }, '차량번호를 조회하면<br>여기에 차량 정보가 나와요');
      (function putPh() {
        var sc = document.querySelector('#contentWrap .saleContent');
        if (sc && !document.getElementById('wl-ph')) sc.insertBefore(ph, sc.firstChild); else if (!sc) setTimeout(putPh, 500);
      })();

      // 아래 큰 버튼 하나 — 차 고르기 전엔 회색 안내, 고르면 「322가8152 주차 등록하기」
      var NOTE = '<span class="n">' + ICON + '건물 내 다른 상가에서 등록하신 경우 최대 1시간만 추가 가능</span>';
      var go = el('button', { type: 'button', id: 'wl-go', class: 'wait' }, '<span class="m">조회하기</span>' + NOTE);
      root.appendChild(go);

      // 방문 경로 질문 — 가볍게 뜨는 팝업(닫기·넘어가기 없음)
      var ask = el('div', { class: 'wl-pop off', id: 'wl-ask' });
      var card = el('div', { class: 'wl-card' },
        '<div class="q-s">등록 전에 하나만 알려 주세요</div><div class="q">어디서 웨이브랩스를 보고 오셨어요?</div>');
      var grid = el('div', { class: 'grid' });
      card.appendChild(grid); ask.appendChild(card); root.appendChild(ask);

      // 진행·결과 — 같은 모양의 작은 카드
      var res = el('div', { class: 'wl-pop off', id: 'wl-res' });
      var rcard = el('div', { class: 'wl-card' });
      res.appendChild(rcard); root.appendChild(res);

      var picked = '';
      CH.forEach(function (c) {
        var b = el('button', { type: 'button' }, c);
        b.addEventListener('click', function () { picked = c; run(); });
        grid.appendChild(b);
      });

      function digits() {
        var t = document.querySelector('#contentWrap .keypad_top');
        return t ? (t.textContent || '').replace(/\D/g, '') : '';
      }
      var mode = 'query';
      go.addEventListener('click', function () {
        if (go.classList.contains('wait')) return;
        if (mode === 'reg') { ask.classList.remove('off'); return; }
        var ok = document.querySelector('#mf_wfm_body_keypadOkBtn input') || document.getElementById('mf_wfm_body_keypadOkBtn');
        if (ok) ok.click();
      });

      async function run() {
        ask.classList.add('off');
        var car = carNoText();
        rcard.innerHTML = (car ? '<div class="car">' + car + '</div>' : '') + '<div class="done">등록 중…</div>';
        res.classList.remove('off');
        var r = await applyHours();
        var total = r.got + r.mineBefore;
        record(picked, r.got, r.note);
        var main = total > 0 ? '주차 등록 ' + total + '시간 완료' : '주차 등록이 안 됐어요 · 픽업대에 말씀해 주세요';
        var left = Math.round(DONE_MS / 1000);
        function paint() {
          rcard.innerHTML = (car ? '<div class="car">' + car + '</div>' : '') + '<div class="done">' + main + '</div>' +
            '<div class="cnt">' + left + '초 뒤 처음 화면으로</div>';
        }
        paint();
        var tm = setInterval(function () { left--; if (left <= 0) { clearInterval(tm); home(); } else paint(); }, 1000);
        res.addEventListener('click', home);
      }

      // 버튼 상태: 번호를 누르는 중이면 「조회하기」(4자리면 켜짐) · 조회돼서 번호칸이 비면 「322가8152 주차 등록하기」
      setInterval(function () {
        var d = digits();
        var hasCar = !!(carPicked && carNoText());
        mode = (hasCar && !d) ? 'reg' : 'query';
        var nm = document.getElementById('_modal');   // 나이스 알림창이 떠 있으면 버튼을 숨겨 「확인」을 가리지 않게
        var niceModal = !!(nm && nm.getClientRects().length && getComputedStyle(nm).display !== 'none');
        var lay = document.getElementById('mf_wfm_body_carListLayer');   // 같은 번호 차가 여러 대면 나오는 목록
        var listOpen = !!(lay && lay.getClientRects().length && getComputedStyle(lay).display !== 'none');
        var busy = niceModal || listOpen || !ask.classList.contains('off') || !res.classList.contains('off');
        go.classList.toggle('hide', busy);
        go.classList.toggle('wait', mode === 'query' && d.length < 4);
        document.documentElement.classList.toggle('wl-nocar', !hasCar);
        var m = go.querySelector('.m');
        var want = mode === 'reg' ? carNoText() + '  주차 등록하기' : '조회하기';
        if (m && m.textContent !== want) m.textContent = want;
      }, 300);

      // 안 만지면 처음으로
      var last = Date.now();
      ['touchstart', 'mousedown', 'keydown'].forEach(function (ev) {
        document.addEventListener(ev, function () { last = Date.now(); }, { passive: true, capture: true });
      });
      setInterval(function () {
        var busy = !res.classList.contains('off');
        if (!busy && (carPicked || !ask.classList.contains('off')) && Date.now() - last > IDLE_MS) home();
      }, 3000);

      // 시험용: 차를 고른 것처럼 보이기
      window.__wlSim = function (others) {
        carPicked = true; lastCarTk = others ? [{ webDisShpNm: '다른 상가', discountTkKnd: '10000060', useCnt: 1 }] : [];
        ['mf_wfm_body_carNoText', 'mf_wfm_body_mobileCarNoText'].forEach(function (id) { var e = document.getElementById(id); if (e && !e.textContent.trim()) e.textContent = '322가8152'; });
      };
      flush();
    }

    var tries = 0;
    (function wait() {
      if (document.getElementById('mf_wfm_body_keypadOkBtn')) return build();
      if (++tries < 60) setTimeout(wait, 500);
    })();
  }
  main();
})();
