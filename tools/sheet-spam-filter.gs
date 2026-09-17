/**
 * Scenic Mountain Roofing — estimate-request spam filter.
 *
 * This does NOT run on the website. It is Google Apps Script, bound to the
 * spreadsheet that the "Scenic Mountain Roofing Estimate Request" form feeds.
 * It is kept in the repo so the scoring rules are reviewable and versioned;
 * the copy that actually runs lives in the Sheet (Extensions → Apps Script).
 * Edit here, then paste the whole file over the script editor's contents.
 *
 * WHAT IT CAN AND CANNOT DO
 *
 * It cannot refuse a submission. The site POSTs straight to Google Forms, so
 * by the time this runs the row already exists — see "The estimate form" in
 * CLAUDE.md. What it does is keep junk away from a human: every response is
 * scored, and anything over the threshold is moved off the responses sheet
 * onto a "Spam" sheet, with its score and the reasons recorded so a false
 * positive can be spotted and dragged back. Nothing is ever deleted.
 *
 * SETUP (once)
 *
 *  1. Open the responses spreadsheet → Extensions → Apps Script.
 *  2. Paste this file over Code.gs and Save.
 *  3. Set NOTIFY_TO below, or leave it '' to skip email entirely.
 *  4. Pick installTrigger from the function dropdown and Run it once. Approve
 *     the permission prompt — it asks for spreadsheet and send-email access,
 *     which is what the two jobs need. Do NOT Run onFormSubmit by hand; it is
 *     trigger-only and has no submission to read. runSelfTest() is the one that
 *     is safe to press Run on.
 *  5. In the FORM (not the Sheet), Responses → ⋮ → turn OFF "Get email
 *     notifications for new responses". That notification is sent by Forms
 *     before this script ever runs, so leaving it on mails you the spam too
 *     and defeats the whole exercise.
 *
 * TUNING
 *
 * Every rule below adds to a score and appends a human-readable reason. Read
 * the Spam sheet's "Why" column for a week before changing weights — it tells
 * you which rule is doing the work and which is misfiring. Raise
 * SPAM_THRESHOLD to be more permissive, lower it to be stricter.
 */

/* ── Config ─────────────────────────────── */

/** Where clean leads are emailed. Set to '' to disable notification. */
const NOTIFY_TO = 'tayton@scenicmtnroofing.com';

/** Score at or above which a response is treated as spam. */
const SPAM_THRESHOLD = 4;

/** Sheet that quarantined rows are moved to. Created on first use. */
const SPAM_SHEET_NAME = 'Spam';

/**
 * Velocity limits. There is no IP address to rate-limit on — Google Forms does
 * not record one and Apps Script never sees the request — so these work on
 * submission time and content instead.
 *
 * Weighted deliberately: a hailstorm over Utah County produces a genuine burst
 * of real leads, so raw speed alone must never be enough to quarantine. What is
 * decisive is the same *content* arriving twice, which a storm does not cause.
 */
const BURST_WINDOW_MS = 2 * 60 * 1000;   // 4+ submissions inside 2 minutes
const BURST_COUNT = 4;
const REPEAT_CONTACT_MS = 60 * 60 * 1000;  // same phone/email inside an hour
const DUPLICATE_MS = 24 * 60 * 60 * 1000;  // identical message inside a day

/** How many recent submissions to remember for the checks above. */
const HISTORY_LIMIT = 60;

/** Script-properties key holding that rolling history. */
const HISTORY_KEY = 'smr.recent.v1';

/**
 * Pitch vocabulary. Contractor sites get far more agency spam than anything
 * else, so these are weighted, not decisive — a real customer could plausibly
 * write "insurance" or "financing".
 */
const PITCH_WORDS = [
  'seo', 'backlink', 'back link', 'guest post', 'link building',
  'rank your', 'ranking on google', 'first page of google', 'search rankings',
  'web design', 'website redesign', 'digital marketing', 'marketing agency',
  'lead generation', 'grow your business', 'increase traffic', 'boost traffic',
  'crypto', 'bitcoin', 'forex', 'investment opportunity', 'loan offer',
  'viagra', 'casino', 'escort', 'porn',
  'dear sir', 'dear madam', 'to whom it may concern',
  'i am reaching out', 'quick question about your website',
  'noticed your website', 'saw your site',
];

/* ── Entry point ────────────────────────── */

/**
 * Installable on-form-submit trigger. Named rather than using the reserved
 * simple trigger, because a simple onFormSubmit cannot send email or write to
 * another sheet — it runs without authorization.
 */
function onFormSubmit(e) {
  // Pressing Run in the editor calls this with no event object, which used to
  // surface as "Cannot read properties of undefined (reading 'range')" — true
  // but useless. There is nothing to run by hand here: this function only has
  // meaning when a form submission hands it a row.
  if (!e || !e.range) {
    console.log(
      'onFormSubmit is trigger-only and cannot be run by hand — there is no ' +
      'submission for it to read.\n\n' +
      'You probably meant one of:\n' +
      '  installTrigger()      — run once to wire this script to the form\n' +
      '  runSelfTest()         — check the scoring rules right now, changes nothing\n' +
      '  dryRunExistingRows()  — score the responses already in the sheet\n\n' +
      'Then submit a real test response through the form to exercise this.');
    return;
  }

  // Two submissions landing together would otherwise let one delete a row out
  // from under the other's row index.
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (err) {
    console.error('Could not obtain lock; leaving row in place. ' + err);
    return;
  }

  try {
    const sheet = e.range.getSheet();
    const row = e.range.getRow();
    const fields = readFields(e);
    const history = loadHistory();
    const verdict = score(fields, history, Date.now());

    // Recorded for every submission, spam or not: quarantined rows leave the
    // responses sheet, so a burst would otherwise erase its own evidence.
    saveHistory(history, fields, Date.now());

    if (verdict.score >= SPAM_THRESHOLD) {
      quarantine(sheet, row, verdict);
      console.log('Quarantined row ' + row + ' (score ' + verdict.score + '): ' +
                  verdict.reasons.join('; '));
      return;
    }

    notify(fields, verdict);
  } catch (err) {
    // Never let a scoring bug lose a lead: on error the row simply stays put.
    console.error('Spam filter failed, row left in place. ' + err + '\n' + err.stack);
  } finally {
    lock.releaseLock();
  }
}

/* ── Field resolution ───────────────────── */

/**
 * The Sheet's column headers are the Google Form's question titles, which are
 * currently the build-time sentinels (FIRSTNAME, LASTNAME, …) but are meant to
 * be renamed to human labels. Renaming a question does not change its entry id,
 * so the site keeps working — but it does rename this column. Match on a
 * normalized alias list so either naming resolves.
 */
const FIELD_ALIASES = {
  first:       ['firstname', 'first'],
  last:        ['lastname', 'last'],
  phone:       ['phone'],
  email:       ['email'],
  city:        ['city'],
  service:     ['service', 'whatdoyouneed'],
  details:     ['details', 'anythingelse', 'message', 'notes', 'comment'],
  shingle:     ['shingle'],
  dripedge:    ['dripedge'],
  accessories: ['accessor'],
};

function normalizeHeader(header) {
  return String(header).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function readFields(e) {
  const named = e.namedValues || {};
  const out = {};

  Object.keys(FIELD_ALIASES).forEach(function (key) { out[key] = ''; });

  Object.keys(named).forEach(function (header) {
    const norm = normalizeHeader(header);
    Object.keys(FIELD_ALIASES).forEach(function (key) {
      // Prefix, not equality. A renamed question keeps its own wording —
      // "Anything else we should know?" normalizes to anythingelseweshouldknow,
      // which no exact alias would ever match, and the field would go silently
      // missing from both the score and the notification email.
      const matched = FIELD_ALIASES[key].some(function (alias) {
        return norm.indexOf(alias) === 0;
      });
      if (matched) {
        const value = named[header];
        out[key] = String(Array.isArray(value) ? value.join(' ') : value).trim();
      }
    });
  });

  return out;
}

/* ── Scoring ────────────────────────────── */

/**
 * Two copies on purpose. `test()` on a /g regex advances its own lastIndex and
 * so returns a different answer on the next call with the same string — the
 * global one is only ever used with String#match, which is stateless.
 */
const URL_SOURCE = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|net|org|ru|cn|xyz|top|info|biz|shop|club|online|site)\b/
  .source;
const URL_RE_ALL = new RegExp(URL_SOURCE, 'gi');
const URL_RE_ONE = new RegExp(URL_SOURCE, 'i');

/**
 * Pure: every input arrives as an argument so the rules can be exercised
 * without a spreadsheet. `history` is the rolling log, `now` an epoch ms.
 */
function score(f, history, now) {
  const reasons = [];
  let total = 0;
  history = history || [];
  now = now || Date.now();

  function hit(points, why) {
    total += points;
    reasons.push(why + ' (+' + points + ')');
  }

  const details = f.details || '';
  const name = (f.first + ' ' + f.last).trim();

  // Links. A roofing customer occasionally pastes one map link; nobody pastes
  // two, and nobody puts a URL in the name or city box.
  const detailUrls = details.match(URL_RE_ALL) || [];
  if (detailUrls.length === 1) hit(2, 'A link in the message');
  if (detailUrls.length >= 2) hit(4, detailUrls.length + ' links in the message');
  if (URL_RE_ONE.test(name) || URL_RE_ONE.test(f.city)) hit(4, 'A link in the name or city field');

  // Markup. Real people do not send HTML or BBCode through a contact form.
  if (/<\/?[a-z][\s\S]*>|\[url[=\]]|\[link[=\]]/i.test(details)) hit(3, 'HTML or BBCode markup');

  // Agency pitch vocabulary.
  const haystack = (name + ' ' + details + ' ' + f.city + ' ' + f.service).toLowerCase();
  const pitched = PITCH_WORDS.filter(function (w) { return haystack.indexOf(w) !== -1; });
  if (pitched.length) {
    hit(Math.min(4, pitched.length * 2), 'Sales-pitch wording: ' + pitched.slice(0, 3).join(', '));
  }

  // Contact details that cannot be contacted. The site marks both required,
  // so a blank one means the POST bypassed the page entirely.
  const digits = (f.phone.match(/\d/g) || []).length;
  if (!f.phone) hit(3, 'No phone number (the site requires one)');
  else if (digits < 7) hit(2, 'Phone number has only ' + digits + ' digits');

  if (!f.email) hit(3, 'No email address (the site requires one)');
  else if (!/^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/.test(f.email)) hit(2, 'Email is malformed');

  if (!f.first && !f.last) hit(3, 'No name at all');
  if (/\d/.test(name)) hit(1, 'Digits in the name');

  // Bulk senders write essays; homeowners write a few lines.
  if (details.length > 1500) hit(1, 'Unusually long message (' + details.length + ' chars)');

  // Service area is Utah. Non-Latin script is a weak signal on its own and is
  // deliberately not enough to quarantine by itself.
  if (/[Ѐ-ӿ一-鿿؀-ۿ]/.test(name + details)) {
    hit(1, 'Non-Latin script');
  }

  // Velocity. No IP to key on, so: how many came in at once, and did this
  // exact submission arrive before?
  const burst = history.filter(function (h) { return now - h.t <= BURST_WINDOW_MS; });
  if (burst.length >= BURST_COUNT - 1) {
    hit(2, (burst.length + 1) + ' submissions within ' +
           Math.round(BURST_WINDOW_MS / 1000) + 's');
  }

  const contact = (f.email || f.phone).toLowerCase();
  if (contact) {
    const repeats = history.filter(function (h) {
      return now - h.t <= REPEAT_CONTACT_MS && h.contact === contact;
    });
    if (repeats.length) {
      hit(3, 'Same phone or email submitted ' + repeats.length + 'x in the last hour');
    }
  }

  const fp = fingerprint(f);
  if (fp) {
    const dupes = history.filter(function (h) {
      return now - h.t <= DUPLICATE_MS && h.fp === fp;
    });
    if (dupes.length) {
      hit(4, 'Identical message already submitted ' + dupes.length + 'x today');
    }
  }

  return { score: total, reasons: reasons };
}

/**
 * Content fingerprint for duplicate detection. Punctuation and case are
 * stripped so trivially reworded resends still collide. Short messages are
 * skipped — "leak in roof" is something two real customers might both write.
 */
function fingerprint(f) {
  const text = (f.details || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (text.length < 25) return '';
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  }
  return String(h);
}

/* ── Rolling history ───────────────── */

function loadHistory() {
  try {
    const raw = PropertiesService.getScriptProperties().getProperty(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.error('History unreadable, starting fresh. ' + err);
    return [];
  }
}

function saveHistory(history, f, now) {
  try {
    history.push({
      t: now,
      contact: (f.email || f.phone).toLowerCase(),
      fp: fingerprint(f),
    });
    const trimmed = history.slice(-HISTORY_LIMIT);
    PropertiesService.getScriptProperties()
      .setProperty(HISTORY_KEY, JSON.stringify(trimmed));
  } catch (err) {
    // Losing history degrades the velocity rules; it must not lose the lead.
    console.error('Could not write history. ' + err);
  }
}

/* ── Quarantine ─────────────────────────── */

function quarantine(sheet, row, verdict) {
  const ss = sheet.getParent();
  const width = sheet.getLastColumn();
  const values = sheet.getRange(row, 1, 1, width).getValues()[0];

  let spam = ss.getSheetByName(SPAM_SHEET_NAME);
  if (!spam) {
    spam = ss.insertSheet(SPAM_SHEET_NAME);
    const headers = sheet.getRange(1, 1, 1, width).getValues()[0];
    spam.appendRow(headers.concat(['Score', 'Why', 'Quarantined']));
    spam.setFrozenRows(1);
  }

  spam.appendRow(values.concat([verdict.score, verdict.reasons.join('; '), new Date()]));
  sheet.deleteRow(row);
}

/* ── Notification ───────────────────────── */

function notify(f, verdict) {
  if (!NOTIFY_TO) return;

  const name = (f.first + ' ' + f.last).trim() || '(no name given)';
  const lines = [
    'New estimate request from the website.',
    '',
    'Name:       ' + name,
    'Phone:      ' + f.phone,
    'Email:      ' + f.email,
    'City:       ' + f.city,
    'Service:    ' + f.service,
    '',
    'Colors chosen in the Color Studio:',
    '  Shingle:    ' + (f.shingle || '—'),
    '  Drip edge:  ' + (f.dripedge || '—'),
    '  Accessories:' + (f.accessories || '—'),
    '',
    'Details:',
    f.details || '(none)',
  ];

  // A response that scored but stayed under the threshold is worth a glance.
  if (verdict.score > 0) {
    lines.push('', '— Spam score ' + verdict.score + '/' + SPAM_THRESHOLD +
                   ': ' + verdict.reasons.join('; '));
  }

  MailApp.sendEmail({
    to: NOTIFY_TO,
    subject: 'Estimate request — ' + name + (f.city ? ' (' + f.city + ')' : ''),
    body: lines.join('\n'),
    replyTo: /^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/.test(f.email) ? f.email : undefined,
  });
}

/* ── Install / maintenance ──────────────── */

/** Run once by hand after pasting this file in. Safe to re-run. */
function installTrigger() {
  const ss = SpreadsheetApp.getActive();

  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'onFormSubmit') ScriptApp.deleteTrigger(t);
  });

  ScriptApp.newTrigger('onFormSubmit')
    .forSpreadsheet(ss)
    .onFormSubmit()
    .create();

  console.log('Trigger installed on "' + ss.getName() + '".');
}

/**
 * Safe to run by hand at any time: exercises the scoring rules against known
 * inputs and logs a pass/fail line for each. Touches no sheet, sends no mail,
 * writes no history. Run this after changing a weight or a PITCH_WORD.
 */
function runSelfTest() {
  const now = Date.now();
  const mk = function (o) {
    const nv = {};
    Object.keys(o).forEach(function (k) { nv[k] = [o[k]]; });
    return { namedValues: nv };
  };

  const cases = [
    ['legit — ordinary repair request', false, mk({
      FIRSTNAME: 'Sarah', LASTNAME: 'Jorgensen', PHONE: '801-555-0142',
      EMAIL: 'sarah.j@gmail.com', CITY: 'Heber City', SERVICE: 'Roof repair',
      DETAILS: 'We have a leak above the garage after the last windstorm. Roof is about 18 years old.' })],
    ['legit — one map link', false, mk({
      FIRSTNAME: 'Dee', LASTNAME: 'Olsen', PHONE: '8015550188',
      EMAIL: 'dee@olsenfamily.net', CITY: 'Ogden', SERVICE: 'Full roof replacement',
      DETAILS: 'Here is the house: https://maps.google.com/?q=123 Main. Hail damage on the north slope.' })],
    ['spam — agency pitch', true, mk({
      FIRSTNAME: 'Rahul', LASTNAME: 'K', PHONE: '1234', EMAIL: 'seo.expert99@gmail.com',
      CITY: 'Delhi', SERVICE: 'Roof repair',
      DETAILS: 'I noticed your website is not ranking on google. We do SEO and link building. Visit www.seorank.xyz for backlink offers.' })],
    ['spam — bare direct POST', true, mk({ DETAILS: 'test' })],
  ];

  let failed = 0;
  cases.forEach(function (c) {
    const verdict = score(readFields(c[2]), [], now);
    const quarantined = verdict.score >= SPAM_THRESHOLD;
    const ok = quarantined === c[1];
    if (!ok) failed++;
    console.log((ok ? 'PASS  ' : 'FAIL  ') + c[0] +
                ' — score ' + verdict.score + '/' + SPAM_THRESHOLD +
                (verdict.reasons.length ? ' — ' + verdict.reasons.join('; ') : ' — clean'));
  });

  // Velocity: a storm burst must score but must not quarantine on its own.
  const legit = readFields(cases[0][2]);
  const base = score(legit, [], now).score;
  const burst = score(legit, [1, 2, 3].map(function (i) {
    return { t: now - i * 1000, contact: 'other' + i + '@x.com', fp: 'fp' + i };
  }), now);
  const burstOk = burst.score < SPAM_THRESHOLD && burst.score > base;
  if (!burstOk) failed++;
  console.log((burstOk ? 'PASS  ' : 'FAIL  ') +
              'burst of real leads scores but survives — score ' + burst.score);

  // Velocity: the same message twice must quarantine.
  const dupe = score(legit, [{ t: now - 60000, contact: 'x@y.com', fp: fingerprint(legit) }], now);
  const dupeOk = dupe.score >= SPAM_THRESHOLD;
  if (!dupeOk) failed++;
  console.log((dupeOk ? 'PASS  ' : 'FAIL  ') +
              'identical resend quarantines — score ' + dupe.score);

  console.log(failed === 0 ? '\nAll checks passed.' : '\n' + failed + ' CHECK(S) FAILED.');
}

/**
 * Score the existing responses without moving anything, and log the result.
 * Use this to sanity-check a weight change against real data before trusting
 * it, and to see what the filter would have caught historically.
 */
function dryRunExistingRows() {
  const sheet = SpreadsheetApp.getActive().getSheets()[0];
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) {
    console.log('No responses yet.');
    return;
  }

  const headers = data[0];
  data.slice(1).forEach(function (row, i) {
    const named = {};
    headers.forEach(function (h, c) { named[h] = [row[c]]; });
    const verdict = score(readFields({ namedValues: named }), [], Date.now());
    console.log('Row ' + (i + 2) + ': score ' + verdict.score +
                (verdict.score >= SPAM_THRESHOLD ? ' — WOULD QUARANTINE' : '') +
                (verdict.reasons.length ? ' — ' + verdict.reasons.join('; ') : ''));
  });
}
