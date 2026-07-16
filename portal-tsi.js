/* =====================================================================
   TSI 2.0 Portal — shared progress layer (portal-tsi.js, schema v1)
   ---------------------------------------------------------------------
   Forked from the Algebra 1 portal's portal.js. Same mechanics
   (record/hint/mastery math/ID sync), different registry and a
   different storage key so the two portals never collide. Exposed as
   window.TSIPortal (not window.Portal) so a future combined teacher
   page can load both scripts on one page and read both without a
   naming collision — see the teacher-portal plan from last session.

   API (identical shape to Portal):
     TSIPortal.record('AR.1', true, {level: 2})
     TSIPortal.hint('AR.1')
     TSIPortal.skill('AR.1')
     TSIPortal.summary()
     TSIPortal.reportCode()

   SYNC / SPREADSHEET NOTE (per last session's decision):
     Same student ID, same spreadsheet as Algebra 1 — but its own tab.
     SYNC_URL below is set to the SAME Apps Script deployment as
     portal.js for now, and every request now includes a `portal:'tsi'`
     field (POST body) / `&portal=tsi` (GET query). The Apps Script
     itself still needs a matching update to branch on that field and
     read/write the TSI tab instead of the Algebra 1 tab — until that
     ships, syncing will still hit the same tab as Algebra 1. Flagged
     with TODO below; don't treat sync as live until the script side
     is confirmed.

   Standard a standard's file lives at is SECTION-level here, unlike
   the Algebra 1 registry (one file per TEKS standard). TSI's 25
   subcategories are finer-grained than TEKS standards, so all of a
   section's standards share one practice page (e.g. AR.1-AR.5 all
   live in apps/tsi-ar.html), the same way teks-a2.html houses A.2A-I.
   ===================================================================== */
(function () {
  'use strict';

  /* TODO: confirm this is the right deployment once the Apps Script is
     updated to branch on `portal`. Currently identical to portal.js's
     SYNC_URL — same spreadsheet, tab routing not yet implemented server-side. */
  var SYNC_URL = 'https://script.google.com/macros/s/AKfycbwvP9DR8ZfNloUR0Mn1IogfjyPB1kZKTP_ss1o8-sivIY2EYCIR9WBOoY5aX8qHRLnrCQ/exec';
  var PORTAL_TAG = 'tsi';               // sent with every sync request; server routes on this

  var LS_KEY = 'eehsTSI.v1';            // student data (persists across sessions)
  var SS_KEY = 'eehsTSI.guest.v1';      // guest data  (dies with the tab)
  var SS_MODE = 'eehsTSI.mode';         // 'guest' once guest mode is chosen
  var KEY = LS_KEY;

  var ID_RE = /^\d{6}$/;                // same 6-digit ID as Algebra 1

  /* ---------------- SECTIONS (the four TSIA2 content strands) ----------------
     `note` = CRC item weight, shown in the hub's section eyebrow (Diagnostic
     Test weights all four strands equally at 12 items each — CRC does not). */
  var SECTIONS = [
    { id: 'alg',   name: 'Algebraic Reasoning',                     code: 'AR',  accent: '#a3324a', note: '7 of 20 CRC items' },
    { id: 'quant', name: 'Quantitative Reasoning',                  code: 'QR',  accent: '#5f7a3d', note: '6 of 20 CRC items' },
    { id: 'prob',  name: 'Probabilistic and Statistical Reasoning', code: 'PSR', accent: '#0f8b8d', note: '4 of 20 CRC items' },
    { id: 'geo',   name: 'Geometric and Spatial Reasoning',         code: 'GSR', accent: '#c2680c', note: '3 of 20 CRC items' }
  ];

  /* ---------------- STANDARD REGISTRY ----------------
     SOURCE: THECB/College Board TSIA2 Mathematics Test Specifications
     v1.4 (Jan 2021), Table 1 — `name` is the official subcategory
     wording verbatim. Order matches the spec (foundational -> complex).
     - onCRC   : false = Diagnostic-only subcategory (asterisked in spec)
     - status  : 'soon' for all standards right now — the section FILES
                 exist as of this build, but no per-standard question
                 generator is wired up yet. Flip a standard to 'ready'
                 only once its gen/prompt/check logic is actually built,
                 same incremental approach as the Algebra 1 portal.
     - reuse   : informational only (not read by any tracking code) —
                 where content can be ported from when it's time to
                 build that standard. null = clean new build. */
  var REGISTRY = [
    /* --- Algebraic Reasoning (AR) --- */
    { sec: 'alg', id: 'AR.1', code: 'AR.1', onCRC: true, status: 'ready',
      name: 'Solve linear equations, inequalities, and systems of linear equations.',
      reuse: 'apps/teks-a2.html + apps/teks-a5.html (not used — built from math_software_best_practices.md instead; see tsi_ar_tweaking_log.md)',
      file: 'apps/tsi-ar.html', modules: ['AR.1'] },
    { sec: 'alg', id: 'AR.2', code: 'AR.2', onCRC: true, status: 'ready',
      name: 'Evaluate linear functions.',
      reuse: 'apps/teks-a3.html + apps/teks-a12.html (A.12B) — not used, built from math_software_best_practices.md; see tsi_ar_tweaking_log.md',
      file: 'apps/tsi-ar.html', modules: ['AR.2'] },
    { sec: 'alg', id: 'AR.3', code: 'AR.3', onCRC: true, status: 'ready',
      name: 'Solve quadratic and exponential relationship problems in context (e.g., exponential decay/growth, compound interest, and depreciation).',
      reuse: 'apps/teks-a6/7/8.html + apps/teks-a9.html — not used, built from math_software_best_practices.md; see tsi_ar_tweaking_log.md',
      file: 'apps/tsi-ar.html', modules: ['AR.3'] },
    { sec: 'alg', id: 'AR.4', code: 'AR.4', onCRC: true, status: 'ready',
      name: 'Identify and manipulate quadratic, polynomial, exponential, rational, and radical equations and expressions.',
      reuse: 'apps/teks-a6/9/10/11.html \u2014 rational expressions are new (Alg II TEKS); not used, built from math_software_best_practices.md — see tsi_ar_tweaking_log.md',
      file: 'apps/tsi-ar.html', modules: ['AR.4'] },
    { sec: 'alg', id: 'AR.5', code: 'AR.5', onCRC: true, status: 'ready',
      name: 'Solve equations and evaluate functions (e.g., quadratic, polynomial, exponential, rational, and radical).',
      reuse: 'apps/teks-a7/8/9/12.html \u2014 solving rational equations is new (Alg II TEKS); not used, built from math_software_best_practices.md — see tsi_ar_tweaking_log.md',
      file: 'apps/tsi-ar.html', modules: ['AR.5'] },

    /* --- Quantitative Reasoning (QR) --- */
    { sec: 'quant', id: 'QR.1', code: 'QR.1', onCRC: false, status: 'ready',
      name: 'Perform basic math operations with whole numbers and integers, decimals, and fractions.',
      reuse: 'candidate: legacy proportions/percent app (scope unconfirmed)', file: 'apps/tsi-qr.html', modules: ['QR.1'] },
    { sec: 'quant', id: 'QR.2', code: 'QR.2', onCRC: false, status: 'ready',
      name: 'Round numbers to a given decimal place.',
      reuse: null, file: 'apps/tsi-qr.html', modules: ['QR.2'] },
    { sec: 'quant', id: 'QR.3', code: 'QR.3', onCRC: false, status: 'ready',
      name: 'Compare numbers in a variety of forms, including decimals, fractions, and percents.',
      reuse: null, file: 'apps/tsi-qr.html', modules: ['QR.3'] },
    { sec: 'quant', id: 'QR.4', code: 'QR.4', onCRC: true, status: 'ready',
      name: 'Compare magnitudes of rational and irrational numbers.',
      reuse: null, file: 'apps/tsi-qr.html', modules: ['QR.4'] },
    { sec: 'quant', id: 'QR.5', code: 'QR.5', onCRC: true, status: 'ready',
      name: 'Solve problems with ratios, proportions, and percents.',
      reuse: 'candidate: legacy proportions/percent app', file: 'apps/tsi-qr.html', modules: ['QR.5'] },
    { sec: 'quant', id: 'QR.6', code: 'QR.6', onCRC: true, status: 'ready',
      name: 'Solve proportional relationship problems in context (e.g., linear relationships in financial literacy and numeracy).',
      reuse: 'candidate: legacy app + A.2 word-problem templates', file: 'apps/tsi-qr.html', modules: ['QR.6'] },
    { sec: 'quant', id: 'QR.7', code: 'QR.7', onCRC: true, status: 'ready',
      name: 'Identify, manipulate, and interpret linear equations, inequalities, and expressions.',
      reuse: 'apps/teks-a2.html (A.2A-I) + apps/teks-a5.html', file: 'apps/tsi-qr.html', modules: ['QR.7'] },

    /* --- Geometric and Spatial Reasoning (GSR) --- */
    { sec: 'geo', id: 'GSR.1', code: 'GSR.1', onCRC: false, status: 'soon',
      name: 'Identify common units of measurement.', reuse: null, file: 'apps/tsi-gsr.html', modules: ['GSR.1'] },
    { sec: 'geo', id: 'GSR.2', code: 'GSR.2', onCRC: false, status: 'soon',
      name: 'Identify and define types of angles.', reuse: null, file: 'apps/tsi-gsr.html', modules: ['GSR.2'] },
    { sec: 'geo', id: 'GSR.3', code: 'GSR.3', onCRC: true, status: 'soon',
      name: 'Convert units within systems of measurement.', reuse: null, file: 'apps/tsi-gsr.html', modules: ['GSR.3'] },
    { sec: 'geo', id: 'GSR.4', code: 'GSR.4', onCRC: true, status: 'soon',
      name: 'Find perimeter, area, surface area, and volume using a variety of methods, including estimation.',
      reuse: null, file: 'apps/tsi-gsr.html', modules: ['GSR.4'] },
    { sec: 'geo', id: 'GSR.5', code: 'GSR.5', onCRC: true, status: 'soon',
      name: 'Use transformations to investigate congruence, similarity, and symmetry.',
      reuse: 'NOT A.3E/A.7B \u2014 those transform function graphs, not geometric figures', file: 'apps/tsi-gsr.html', modules: ['GSR.5'] },
    { sec: 'geo', id: 'GSR.6', code: 'GSR.6', onCRC: true, status: 'soon',
      name: 'Apply right triangle relationships and basic trigonometry.', reuse: null, file: 'apps/tsi-gsr.html', modules: ['GSR.6'] },
    { sec: 'geo', id: 'GSR.7', code: 'GSR.7', onCRC: true, status: 'soon',
      name: 'Make connections between geometry and algebraic equations.',
      reuse: 'synthesis module \u2014 build after GSR.3-GSR.6 exist', file: 'apps/tsi-gsr.html', modules: ['GSR.7'] },

    /* --- Probabilistic and Statistical Reasoning (PSR) --- */
    { sec: 'prob', id: 'PSR.1', code: 'PSR.1', onCRC: false, status: 'soon',
      name: 'Sort and count data.', reuse: null, file: 'apps/tsi-psr.html', modules: ['PSR.1'] },
    { sec: 'prob', id: 'PSR.2', code: 'PSR.2', onCRC: false, status: 'soon',
      name: 'Construct simple graphs and tables.',
      reuse: 'candidate: adapt apps/teks-a4.html chart infrastructure', file: 'apps/tsi-psr.html', modules: ['PSR.2'] },
    { sec: 'prob', id: 'PSR.3', code: 'PSR.3', onCRC: true, status: 'soon',
      name: 'Compute and interpret probability.', reuse: null, file: 'apps/tsi-psr.html', modules: ['PSR.3'] },
    { sec: 'prob', id: 'PSR.4', code: 'PSR.4', onCRC: true, status: 'soon',
      name: 'Compute and describe measures of center and spread of data.', reuse: null, file: 'apps/tsi-psr.html', modules: ['PSR.4'] },
    { sec: 'prob', id: 'PSR.5', code: 'PSR.5', onCRC: true, status: 'soon',
      name: 'Classify data and construct appropriate representations of data.',
      reuse: 'apps/teks-a4.html scatterplot piece is one of several representation types', file: 'apps/tsi-psr.html', modules: ['PSR.5'] },
    { sec: 'prob', id: 'PSR.6', code: 'PSR.6', onCRC: true, status: 'soon',
      name: 'Analyze, interpret, and draw conclusions from data.',
      reuse: 'apps/teks-a4.html A.4C regression logic is a narrow slice of this', file: 'apps/tsi-psr.html', modules: ['PSR.6'] }
  ];

  function regById(id) {
    for (var i = 0; i < REGISTRY.length; i++) { if (REGISTRY[i].id === id) return REGISTRY[i]; }
    return null;
  }

  /* ================================================================== */
  /*  STORAGE + MODE  (unchanged from portal.js — subject-agnostic)      */
  /* ================================================================== */
  var mem = null;
  var memMode = 'none';

  var HAS_LS = (function () {
    try { localStorage.setItem('__t', '1'); localStorage.removeItem('__t'); return true; }
    catch (e) { return false; }
  })();
  var HAS_SS = (function () {
    try { sessionStorage.setItem('__ts', '1'); sessionStorage.removeItem('__ts'); return true; }
    catch (e) { return false; }
  })();

  function blank() { return { v: 1, student: { name: '', code: '' }, skills: {}, sessions: {} }; }
  function hasValidCode(d) { return !!(d && d.student && ID_RE.test(d.student.code || '')); }

  function currentMode() {
    if (HAS_LS) {
      try { if (hasValidCode(JSON.parse(localStorage.getItem(LS_KEY)))) return 'student'; }
      catch (e) {}
    } else if (hasValidCode(mem)) {
      return memMode === 'student' ? 'student' : 'none';
    }
    if (HAS_SS && sessionStorage.getItem(SS_MODE) === 'guest') return 'guest';
    if (!HAS_SS && memMode === 'guest') return 'guest';
    return 'none';
  }

  function load() {
    var mode = currentMode();
    if (mode === 'student') {
      if (!HAS_LS) return mem || (mem = blank());
      try { var d = JSON.parse(localStorage.getItem(LS_KEY)); return (d && d.v === 1) ? d : blank(); }
      catch (e) { return blank(); }
    }
    if (HAS_SS) {
      try { var g = JSON.parse(sessionStorage.getItem(SS_KEY)); if (g && g.v === 1) return g; }
      catch (e) {}
      return blank();
    }
    return mem || (mem = blank());
  }

  function save(d) {
    var mode = currentMode();
    if (mode === 'student') {
      if (!HAS_LS) { mem = d; return; }
      try { localStorage.setItem(LS_KEY, JSON.stringify(d)); } catch (e) {}
      return;
    }
    if (HAS_SS) { try { sessionStorage.setItem(SS_KEY, JSON.stringify(d)); } catch (e) {} return; }
    mem = d;
  }

  function today() { return new Date().toISOString().slice(0, 10); }

  /* ================================================================== */
  /*  CORE API — recording answers  (unchanged)                         */
  /* ================================================================== */
  function record(skillId, correct, opts) {
    opts = opts || {};
    var d = load();
    var s = d.skills[skillId] || (d.skills[skillId] = { a: 0, c: 0, h: [], lv: 1, t: 0, hints: 0 });
    var wasMastered = computeStats(s).mastered;
    s.a += 1;
    if (correct) s.c += 1;
    s.h.push(correct ? 1 : 0);
    if (s.h.length > 20) s.h.shift();
    if (opts.level) s.lv = opts.level;
    s.t = Date.now();
    var nowMastered = computeStats(s).mastered;
    if (!wasMastered && nowMastered && s.am == null) s.am = s.a;
    var day = d.sessions[today()] || (d.sessions[today()] = { a: 0, c: 0 });
    day.a += 1;
    if (correct) day.c += 1;
    save(d);
    schedulePush();
    return computeStats(s);
  }

  function hint(skillId) {
    var d = load();
    var s = d.skills[skillId] || (d.skills[skillId] = { a: 0, c: 0, h: [], lv: 1, t: 0, hints: 0 });
    s.hints = (s.hints || 0) + 1;
    save(d);
    schedulePush();
  }

  /* ================================================================== */
  /*  MASTERY MATH  (unchanged)                                         */
  /* ================================================================== */
  function computeStats(s) {
    if (!s || !s.a) {
      return { attempts: 0, correct: 0, recentAcc: 0, mastered: false, progress: 0, level: 1, last: 0, hints: 0, attemptsToMastery: null };
    }
    var last10 = s.h.slice(-10);
    var recentAcc = last10.length ? last10.reduce(function (x, y) { return x + y; }, 0) / last10.length : 0;
    var mastered = s.a >= 15 && last10.length >= 10 && recentAcc >= 0.8;
    var progress = Math.min(1, s.a / 15) * recentAcc;
    return {
      attempts: s.a, correct: s.c, recentAcc: recentAcc,
      mastered: mastered, progress: progress,
      level: s.lv || 1, last: s.t || 0, hints: s.hints || 0,
      attemptsToMastery: (s.am != null ? s.am : null)
    };
  }

  function aggregateModules(d, ids) {
    var attempts = 0, correct = 0, progSum = 0, masteredCount = 0,
        accSum = 0, accN = 0, last = 0, hints = 0;
    ids.forEach(function (mid) {
      var st = computeStats(d.skills[mid]);
      attempts += st.attempts; correct += st.correct; progSum += st.progress;
      if (st.mastered) masteredCount += 1;
      if (st.attempts) { accSum += st.recentAcc; accN += 1; }
      if (st.last > last) last = st.last;
      hints += st.hints;
    });
    var n = ids.length || 1;
    return {
      attempts: attempts, correct: correct,
      recentAcc: accN ? accSum / accN : 0,
      mastered: ids.length > 0 && masteredCount === ids.length,
      progress: progSum / n,
      level: 1, last: last, hints: hints,
      modulesMastered: masteredCount, moduleCount: ids.length
    };
  }

  function statsForD(d, reg) {
    if (reg && reg.modules && reg.modules.length) return aggregateModules(d, reg.modules);
    return computeStats(d.skills[reg ? reg.id : undefined]);
  }

  function skill(id) {
    var d = load();
    return statsForD(d, regById(id) || { id: id });
  }

  function summary() {
    var d = load();
    var out = {};
    SECTIONS.forEach(function (sec) {
      var ready = REGISTRY.filter(function (r) { return r.sec === sec.id && r.status === 'ready'; });
      var progSum = 0, mastered = 0, attempts = 0, correct = 0;
      ready.forEach(function (r) {
        var st = statsForD(d, r);
        progSum += st.progress;
        attempts += st.attempts;
        correct += st.correct;
        if (st.mastered) mastered += 1;
      });
      out[sec.id] = {
        progress: ready.length ? progSum / ready.length : 0,
        mastered: mastered, readyCount: ready.length,
        attempts: attempts, correct: correct
      };
    });
    return out;
  }

  function totals() {
    var d = load(), a = 0, c = 0, m = 0;
    REGISTRY.forEach(function (r) {
      if (r.status !== 'ready') return;
      var st = statsForD(d, r);
      a += st.attempts; c += st.correct;
      if (st.mastered) m += 1;
    });
    return { attempts: a, correct: c, mastered: m };
  }

  function nextOnPath() {
    var d = load();
    for (var i = 0; i < REGISTRY.length; i++) {
      var r = REGISTRY[i];
      if (r.status !== 'ready') continue;
      if (!statsForD(d, r).mastered) return r;
    }
    return null;
  }

  /* ================================================================== */
  /*  IDENTITY (guest / student) + SYNC  (unchanged mechanics)          */
  /* ================================================================== */
  function validId(id) { return ID_RE.test(String(id == null ? '' : id).trim()); }
  function mode() { return currentMode(); }

  function studentId() {
    var d = load();
    return (d.student && ID_RE.test(d.student.code || '')) ? d.student.code : '';
  }

  function studentName() {
    var d = load();
    return (d.student && d.student.name) || '';
  }

  function startGuest() {
    if (HAS_SS) {
      try {
        sessionStorage.setItem(SS_MODE, 'guest');
        if (!sessionStorage.getItem(SS_KEY)) sessionStorage.setItem(SS_KEY, JSON.stringify(blank()));
      } catch (e) {}
    } else {
      memMode = 'guest';
      if (!mem) mem = blank();
    }
  }

  function switchId() {
    if (HAS_LS) { try { localStorage.removeItem(LS_KEY); } catch (e) {} }
    if (HAS_SS) { try { sessionStorage.removeItem(SS_KEY); sessionStorage.removeItem(SS_MODE); } catch (e) {} }
    mem = null; memMode = 'none';
  }

  function syncConfigured() {
    return !!SYNC_URL && SYNC_URL.indexOf('PASTE_') !== 0;
  }

  function commitStudent(d) {
    if (HAS_SS) { try { sessionStorage.removeItem(SS_KEY); sessionStorage.removeItem(SS_MODE); } catch (e) {} }
    if (HAS_LS) { try { localStorage.setItem(LS_KEY, JSON.stringify(d)); } catch (e) {} }
    else { mem = d; memMode = 'student'; }
  }

  /* Same round-trip pattern as portal.js, with `portal:'tsi'` added to the
     payload so the (eventually updated) Apps Script can route to the TSI
     tab instead of the Algebra 1 tab. */
  function syncRoundTrip(id, data, cb) {
    fetch(SYNC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ code: id, data: data, portal: PORTAL_TAG })
    })
    .then(function () { return fetch(SYNC_URL + '?code=' + encodeURIComponent(id) + '&portal=' + PORTAL_TAG); })
    .then(function (r) { return r.json(); })
    .then(function (res) {
      if (res && res.found && res.data && res.data.v === 1) cb(true, res.data);
      else cb(false, 'norow');
    })
    .catch(function () { cb(false, 'network'); });
  }

  function identify(id, cb) {
    cb = cb || function () {};
    id = String(id == null ? '' : id).trim();
    if (!ID_RE.test(id)) { cb(false, 'That ID should be exactly 6 digits.'); return; }
    if (!syncConfigured()) { cb(false, 'Progress saving is not set up yet. Ask your teacher.'); return; }

    var local = load();
    local.student = local.student || {};
    local.student.code = id;

    syncRoundTrip(id, local, function (ok, resOrReason) {
      if (!ok) {
        var msg = (resOrReason === 'norow')
          ? 'Could not confirm your record. Please try again.'
          : 'Could not reach the server. Check the connection and try again.';
        cb(false, msg);
        return;
      }
      var merged = resOrReason;
      merged.student = merged.student || {};
      merged.student.code = id;
      commitStudent(merged);
      cb(true, null, merged.student.name || '');
    });
  }

  function refresh(cb) {
    cb = cb || function () {};
    if (currentMode() !== 'student' || !syncConfigured()) { cb(false); return; }
    var d = load();
    if (!d.student || !ID_RE.test(d.student.code || '')) { cb(false); return; }
    syncRoundTrip(d.student.code, d, function (ok, resOrReason) {
      if (!ok) { cb(false); return; }
      var merged = resOrReason;
      merged.student = merged.student || {};
      merged.student.code = d.student.code;
      if (HAS_LS) { try { localStorage.setItem(LS_KEY, JSON.stringify(merged)); } catch (e) {} }
      else { mem = merged; }
      cb(true, merged.student.name || '');
    });
  }

  var pushTimer = null;
  function schedulePush() {
    if (currentMode() !== 'student' || !syncConfigured()) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(doPush, 4000);
  }
  function doPush() {
    if (currentMode() !== 'student' || !syncConfigured()) return;
    var d = load();
    if (!d.student || !ID_RE.test(d.student.code || '')) return;
    fetch(SYNC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ code: d.student.code, data: d, portal: PORTAL_TAG })
    }).catch(function () {});
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'hidden') return;
      if (currentMode() !== 'student' || !syncConfigured()) return;
      var d = load();
      if (d.student && ID_RE.test(d.student.code || '')) {
        try { navigator.sendBeacon(SYNC_URL, JSON.stringify({ code: d.student.code, data: d, portal: PORTAL_TAG })); } catch (e) {}
      }
    });
  }

  /* ================================================================== */
  /*  MANUAL REPORT CODE (backup)  (unchanged)                          */
  /* ================================================================== */
  function reportCode() {
    var d = load();
    var parts = [d.student.name || 'anon', today()];
    Object.keys(d.skills).forEach(function (id) {
      var s = d.skills[id];
      parts.push(id + ':' + s.a + '.' + s.c + '.' + (s.lv || 1));
    });
    var raw = parts.join('|');
    try { return btoa(unescape(encodeURIComponent(raw))); }
    catch (e) { return raw; }
  }

  function decodeReport(code) {
    try {
      var raw = decodeURIComponent(escape(atob(code.trim())));
      var parts = raw.split('|');
      var out = { name: parts[0], date: parts[1], skills: [] };
      for (var i = 2; i < parts.length; i++) {
        var m = parts[i].match(/^(.+):(\d+)\.(\d+)\.(\d+)$/);
        if (m) out.skills.push({ id: m[1], attempts: +m[2], correct: +m[3], level: +m[4] });
      }
      return out;
    } catch (e) { return null; }
  }

  function resetAll() {
    if (HAS_LS) { try { localStorage.removeItem(LS_KEY); } catch (e) {} }
    if (HAS_SS) { try { sessionStorage.removeItem(SS_KEY); sessionStorage.removeItem(SS_MODE); } catch (e) {} }
    mem = null; memMode = 'none';
  }

  /* ---------------- expose as window.TSIPortal (NOT window.Portal) ---------------- */
  window.TSIPortal = {
    KEY: KEY,
    SECTIONS: SECTIONS,
    REGISTRY: REGISTRY,
    regById: regById,
    load: load,
    record: record,
    hint: hint,
    skill: skill,
    summary: summary,
    totals: totals,
    nextOnPath: nextOnPath,

    mode: mode,
    validId: validId,
    studentId: studentId,
    studentName: studentName,
    startGuest: startGuest,
    identify: identify,
    refresh: refresh,
    switchId: switchId,

    reportCode: reportCode,
    decodeReport: decodeReport,
    resetAll: resetAll,

    storageAvailable: HAS_LS,
    sessionAvailable: HAS_SS,
    syncConfigured: syncConfigured
  };
})();
