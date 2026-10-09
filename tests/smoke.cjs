// Smoke test for Playmate: drives index.html in headless Chromium with speech
// recognition, speech output and the microphone mocked. Uses the built-in sample
// scene, so no script file is needed.
//
//   node tests/smoke.cjs            (exit code 0 = all checks passed)
//
// Needs Playwright. In Claude Code cloud sessions it is installed globally and
// Chromium is preinstalled; elsewhere: npm i -D playwright && npx playwright install chromium
const path = require('path');
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }

const PAGE = 'file://' + path.resolve(__dirname, '..', 'index.html');
let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`); if (!ok) failed++; };

(async () => {
  const browser = await pw.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 400, height: 860 } });
  await ctx.addInitScript(() => {
    // what the page asks the speech engine to say
    window.__spoken = [];
    const speak = speechSynthesis.speak.bind(speechSynthesis);
    speechSynthesis.speak = u => { window.__spoken.push(u.text); speak(u); };
    // a recogniser that "hears" the next queued phrase each time one of your lines starts
    window.__heard = [];
    window.SpeechRecognition = class {
      start() { if (!this.onresult) return; const t = window.__heard.shift(); if (t) setTimeout(() => this.onresult?.({ results: [[{ transcript: t }]] }), 200); }
      abort() { setTimeout(() => this.onend?.(), 50); }
      stop() {}
    };
    // keep the mic streams so the test can see whether they were released
    window.__streams = [];
    // a silent microphone (Chromium's own fake device beeps, so a line would never end)
    navigator.mediaDevices.getUserMedia = async () => { const s = new AudioContext().createMediaStreamDestination().stream; window.__streams.push(s); return s; };
  });
  const p = await ctx.newPage();
  p.on('pageerror', e => { console.log('PAGE ERROR', e.message); failed++; });
  await p.route('**/fonts.googleapis.com/**', r => r.abort());
  await p.route('**/cdnjs.cloudflare.com/**', r => r.abort());  // JSZip is only needed for .docx uploads
  await p.goto(PAGE);
  if (await p.isVisible('#bday')) await p.click('#bdayClose');  // the birthday card, if the test runs that week

  check('interface opens in Hebrew', await p.evaluate(() => document.documentElement.lang === 'he' && document.documentElement.dir === 'rtl'));

  await p.evaluate(() => { window.__heard.push('the bus fell over in the rain', 'banana phone'); });
  await p.click('#sampleBtn');
  const chips = await p.$$eval('.chip', c => c.map(x => x.textContent));
  check('character picker shows names only', chips.includes('TOM') && chips.every(c => !/\d/.test(c)), chips.join(','));
  await p.click('.chip:has-text("TOM")');
  await p.click('#startBtn');

  // TOM's first line, said wrong, with "read mistakes aloud" off: red X, no correction spoken
  await p.waitForFunction(() => !document.getElementById('lastHeard').hidden, null, { timeout: 30000 });
  check('heard text and match % shown', /35%/.test(await p.textContent('#lastHeard')), await p.textContent('#lastHeard'));
  check('red X flashed', await p.$eval('#miss', m => m.classList.contains('show')));
  check('correction not read when switch is off', !(await p.evaluate(() => window.__spoken.some(t => t.includes('The bus broke down')))));

  // TOM's second line, said wrong, with the switch on: the correct line is read aloud
  await p.click('#readMistakes');
  await p.waitForFunction(() => window.__spoken.some(t => t.includes('I owe you a coffee')), null, { timeout: 30000 }).catch(() => {});
  check('correction read aloud when switch is on', await p.evaluate(() => window.__spoken.some(t => t.includes('I owe you a coffee'))));

  // mic is released when the tab is hidden
  const before = await p.evaluate(() => window.__streams.some(s => s.getTracks().some(t => t.readyState === 'live')));
  await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  const after = await p.evaluate(() => window.__streams.some(s => s.getTracks().some(t => t.readyState === 'live')));
  check('mic released when the tab is hidden', before && !after, `live before=${before} after=${after}`);
  check('rehearsal paused when the tab is hidden', /▶/.test(await p.textContent('#playBtn')));
  await p.evaluate(() => { delete document.hidden; });

  // settings panel
  await p.click('#settingsBtn');
  check('settings panel opens', await p.$eval('#settingsSheet', d => !d.hidden));
  await p.click('#settingsClose');
  check('settings panel closes', await p.$eval('#settingsSheet', d => d.hidden));

  // jump to my next line lands on one of TOM's lines
  await p.click('#jumpBtn');
  check('jump lands on my line', await p.$eval('.script li.current', li => li.classList.contains('mine')));

  // back button asks before leaving
  await p.goBack(); await p.waitForTimeout(300);
  check('back asks before leaving', await p.$eval('#leaveDlg', d => !d.hidden));

  // switching the interface language leaves the play text alone
  const line = await p.textContent('.script li.mine .txt');
  await p.click('#leaveNo'); await p.click('#uiLangBtn');
  check('English interface, same play text', (await p.evaluate(() => document.documentElement.lang)) === 'en' && line === await p.textContent('.script li.mine .txt'));

  // Android: recognition alone (no mic held for voice detection, which would starve it),
  // one phrase per session, and the recogniser's error code shown when nothing was caught
  const actx2 = await browser.newContext({ viewport: { width: 400, height: 860 }, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36' });
  await actx2.addInitScript(() => {
    window.__gum = 0; window.__heard = ['the bus fell over in the rain']; window.__recs = [];
    speechSynthesis.speak = u => setTimeout(() => u.onend?.(), 10);
    window.SpeechRecognition = class {
      constructor() { window.__recs.push(this); }
      start() { if (!this.onresult) return; const t = window.__heard.shift();
        setTimeout(() => t ? this.onresult?.({ results: [[{ transcript: t }]] }) : (window.__errored = true, this.onerror?.({ error: 'network' })), 200); }
      abort() { setTimeout(() => this.onend?.(), 50); }
      stop() {}
    };
    navigator.mediaDevices.getUserMedia = async () => { window.__gum++; return new AudioContext().createMediaStreamDestination().stream; };
  });
  const a = await actx2.newPage();
  a.on('pageerror', e => { console.log('PAGE ERROR', e.message); failed++; });
  await a.route('**/fonts.googleapis.com/**', r => r.abort());
  await a.route('**/cdnjs.cloudflare.com/**', r => r.abort());
  await a.goto(PAGE);
  if (await a.isVisible('#bday')) await a.click('#bdayClose');
  await a.click('#sampleBtn'); await a.click('.chip:has-text("TOM")'); await a.click('#startBtn');
  await a.waitForFunction(() => !document.getElementById('lastHeard').hidden, null, { timeout: 30000 });
  check('android: line checked by recognition alone', /35%/.test(await a.textContent('#lastHeard')), await a.textContent('#lastHeard'));
  check('android: mic not held alongside recognition', await a.evaluate(() => window.__gum === 0 && document.getElementById('micBtn').hidden));
  check('android: one phrase per recognition session', await a.evaluate(() => window.__recs.filter(r => r.onresult).every(r => r.continuous === false)));
  await a.waitForFunction(() => window.__errored, null, { timeout: 30000 });
  await a.click('#nextBtn');
  await a.waitForFunction(() => /network/.test(document.getElementById('lastHeard').textContent), null, { timeout: 30000 }).catch(() => {});
  check('android: recogniser error shown when nothing was heard', /network/.test(await a.textContent('#lastHeard')), await a.textContent('#lastHeard'));

  // birthday card: opens with confetti on 9 Oct 2026, X closes it, and it's gone after that week
  const card = async (when, setup) => {
    const c = await browser.newContext({ viewport: { width: 400, height: 860 } });
    if (setup) await c.addInitScript(setup);
    const b = await c.newPage();
    b.on('pageerror', e => { console.log('PAGE ERROR', e.message); failed++; });
    await b.clock.setFixedTime(new Date(when));
    await b.route('**/fonts.googleapis.com/**', r => r.abort());
    await b.route('**/cdnjs.cloudflare.com/**', r => r.abort());
    await b.goto(PAGE);
    return { b, c };
  };
  let { b, c } = await card('2026-10-09T08:00:00');
  check('birthday card opens on the day', await b.isVisible('#bday') && /מזל טוב אבא!!/.test(await b.textContent('#bdayTitle')));
  check('confetti on open', await b.$('#confetti') !== null);
  await b.screenshot({ path: path.join(process.env.SHOT_DIR || require('os').tmpdir(), 'bday.png') });
  await b.click('#bdayClose');
  check('X closes the birthday card', !(await b.isVisible('#bday')));
  await c.close();
  ({ b, c } = await card('2026-10-11T08:00:00', () => localStorage.setItem('playmate-bday57', '1')));
  check('card stays closed later that week once closed', !(await b.isVisible('#bday')));
  await c.close();
  ({ b, c } = await card('2026-11-01T08:00:00'));
  check('no birthday card after that week', !(await b.isVisible('#bday')));
  await c.close();

  await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
  process.exit(failed ? 1 : 0);
})();
