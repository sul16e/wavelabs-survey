// 웨이브랩스 셀프 주차 등록 + 방문 경로 — 본체(아이패드의 Userscripts 로더가 매번 이 파일을 새로 불러온다)
// 고칠 땐 이 파일만 고치고 push → 아이패드는 다음 새로고침부터 바로 반영(재설치 필요 없음)
(function () {
  function main() {
    'use strict';
    if (window.__wlParkingCore) return;   // 로더가 둘 깔려 있어도 한 번만
    window.__wlParkingCore = true;
    // 아이패드에서 본체가 실제로 불러와졌는지 확인용(10분에 한 번만)
    try {
      var lp = +(localStorage.getItem('wl-ping') || 0);
      if (Date.now() - lp > 600000) {
        localStorage.setItem('wl-ping', String(Date.now()));
        fetch('https://gsnsroacvbibljpecizu.supabase.co/rest/v1/records', { method: 'POST',
          headers: { apikey: 'sb_publishable_eCxa1FC6BIp3L0FJwI9x5w_I-4LQ-hw', Authorization: 'Bearer sb_publishable_eCxa1FC6BIp3L0FJwI9x5w_I-4LQ-hw', 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify([{ id: 'wlping-' + Date.now().toString(36), kind: 'wl-ping', data: { v: 'core-3.0.2', ua: navigator.userAgent.slice(0, 160), w: innerWidth, h: innerHeight, old: !!document.getElementById('wl-ov') } }]) }).catch(function () {});
      }
    } catch (e) {}

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
      'html.wl-on #mf_wfm_body_mobileGrp{height:auto!important;padding:8px 12px!important;border-radius:16px!important}',
      'html.wl-on #mf_wfm_body_carNo{font-size:30px!important;height:64px!important;font-weight:700!important;letter-spacing:6px;text-align:center}',
      'html.wl-on #mf_wfm_body_mobileOkBtn{transform:scale(1.6)}',
      'html.wl-on #contentWrap .carinfoArea{margin-top:16px!important}',
      '#wl-root{font-family:-apple-system,"Apple SD Gothic Neo",sans-serif;-webkit-user-select:none;user-select:none;color:#15212B}',
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
        // 4자리를 다 넣으면 돋보기 안 눌러도 바로 검색
        inp.addEventListener('input', function () {
          var v = (inp.value || '').replace(/\D/g, '');
          if (v.length === 4) { var ok = document.getElementById('mf_wfm_body_mobileOkBtn'); if (ok) setTimeout(function () { ok.click(); }, 150); }
        });
      }
      var cw = document.getElementById('contentWrap');
      if (cw) ['left', 'margin-left', 'padding-left'].forEach(function (p) { cw.style.setProperty(p, '0', 'important'); });
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
      mask(); setInterval(mask, 500);

      // 아래 큰 버튼 하나 — 차 고르기 전엔 회색 안내, 고르면 「322가8152 주차 등록하기」
      var NOTE = '<span class="n">' + ICON + '건물 내 다른 상가에서 등록하신 경우 최대 1시간만 추가 가능</span>';
      var go = el('button', { type: 'button', id: 'wl-go', class: 'wait' }, '<span class="m">차량번호 뒤 4자리를 입력해 주세요</span>' + NOTE);
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

      go.addEventListener('click', function () { if (!go.classList.contains('wait')) ask.classList.remove('off'); });

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

      // 차가 골라지면 버튼을 「번호 + 주차 등록하기」로
      setInterval(function () {
        var ready = !!(carPicked && carNoText());
        var busy = !ask.classList.contains('off') || !res.classList.contains('off');
        go.classList.toggle('hide', busy);
        go.classList.toggle('wait', !ready);
        var m = go.querySelector('.m');
        var want = ready ? carNoText() + '  주차 등록하기' : '차량번호 뒤 4자리를 입력해 주세요';
        if (m && m.textContent !== want) m.textContent = want;
      }, 400);

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
