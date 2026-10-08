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

  await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
  process.exit(failed ? 1 : 0);
})();
