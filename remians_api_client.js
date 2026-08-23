/**
 * ============================================================
 *  REMIANS CANADA — Google Apps Script API
 *  Paste this entire file into:
 *  Google Sheets → Extensions → Apps Script → Code.gs
 *  Then: Deploy → New deployment → Web app
 *        Execute as: Me
 *        Who has access: Anyone
 *  Copy the deployment URL into your HTML site.
 * ============================================================
 */

// ── SHEET NAMES (must match exactly) ──────────────────────
const SHEET = {
  MEMBERS:  'Members',
  EVENTS:   'Events',
  NEWS:     'News',
  COMMITTEE:'Committee',
  WELFARE:  'Welfare',
  PENDING:  'Pending',
  GALLERY:  'Gallery',
};

// ── CORS HEADERS ───────────────────────────────────────────
function corsHeaders() {
  return ContentService.createTextOutput()
    .setMimeType(ContentService.MimeType.JSON);
}


function respond(data) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, data }))
    .setMimeType(ContentService.MimeType.JSON);
}

function error(msg, code) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: false, error: msg, code: code || 400 }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── MAIN ROUTER ────────────────────────────────────────────
// All requests come in here. Route by ?action=xxx
function doGet(e) {
  try {
    const action = e.parameter.action || '';
    const tier   = e.parameter.tier  || 'public'; // public | free | paid | admin | moderator
    const uid    = e.parameter.uid   || '';        // Firebase UID (passed by frontend)

    switch (action) {
      // ── PUBLIC (no auth) ──────────────────────────
      case 'getEvents':        return getEvents();
      case 'getNews':          return getNews();
      case 'checkRsvp':        return checkRsvp(e.parameter.event_id, uid);

      case 'submitRsvp':
        // Accept GET parameters for RSVP submission (avoids CORS preflight for POST)
        return submitRsvp({
          event_id:        e.parameter.event_id,
          name:            e.parameter.name,
          email:           e.parameter.email,
          paid:            e.parameter.paid,
          etransfer_ref:   e.parameter.etransfer_ref,
          adult_male:      e.parameter.adult_male,
          adult_female:    e.parameter.adult_female,
          kids_5_18_male:  e.parameter.kids_5_18_male,
          kids_5_18_female:e.parameter.kids_5_18_female,
          age_0_5:         e.parameter.age_0_5,
          need_ride:       e.parameter.need_ride,
          ride_persons:    e.parameter.ride_persons,
          ride_postal:     e.parameter.ride_postal,
          offer_ride:      e.parameter.offer_ride,
          offer_seats:     e.parameter.offer_seats,
          offer_postal:    e.parameter.offer_postal,
          volunteer:       e.parameter.volunteer,
          bring_items:     e.parameter.bring_items,
        }, uid);
      case 'getCommittee':     return getCommittee();
      case 'getWelfareStats':  return getWelfareStats();
      case 'getGallery':       return getGallery();

      // ── AUTH HELPER ───────────────────────────────
      case 'getMemberTier':
        if (!uid) return respond({ tier: 'public', status: 'unknown' });
        const mbrTier = getMemberByUid(uid);
        // Returns tier AND status so frontend can enforce both checks:
        //   status = 'pending'   -> not yet approved by committee
        //   status = 'approved'  -> full access based on tier
        //   status = 'suspended' -> account blocked
        //   null (not in Members sheet) -> still in Pending sheet
        return respond({
          tier:   mbrTier ? (mbrTier.tier   || 'free')    : 'pending',
          status: mbrTier ? (mbrTier.status || 'pending') : 'pending',
        });

      // ── FREE MEMBER (name/batch/city only) ────────
      case 'getDirectoryBasic':
        if (!uid) return error('Authentication required', 401);
        return getDirectoryBasic();

      // ── PAID MEMBER (full profiles) ───────────────
      case 'getDirectoryFull':
        if (!uid) return error('Authentication required', 401);
        if (!isPaidOrAbove(uid)) return error('Paid membership required', 403);
        return getDirectoryFull();

      case 'getMemberProfile':
        if (!uid) return error('Authentication required', 401);
        if (!isPaidOrAbove(uid)) return error('Paid membership required', 403);
        return getMemberProfile(e.parameter.memberId);

      // ── ADMIN ─────────────────────────────────────
      case 'getPending':
        if (!isAdmin(uid)) return error('Admin access required', 403);
        return getPending();

      case 'getDashboardStats':
        if (!isAdminOrMod(uid)) return error('Admin access required', 403);
        return getDashboardStats();

      default:
        return error('Unknown action: ' + action, 404);
    }
  } catch(err) {
    return error('Server error: ' + err.message, 500);
  }
}

// POST handles writes (create/update/delete)
function doPost(e) {
  try {
    const body   = JSON.parse(e.postData.contents);
    const action = body.action || '';
    const uid    = body.uid    || '';

    switch (action) {
      // ── PUBLIC ────────────────────────────────────
      case 'registerMember':   return registerMember(body);
      case 'contactForm':      return contactForm(body);

      // ── MODERATOR / ADMIN ─────────────────────────
      case 'createEvent':
        if (!isAdminOrMod(uid)) return error('Not authorized', 403);
        return createEvent(body);

      case 'updateEvent':
        if (!isAdminOrMod(uid)) return error('Not authorized', 403);
        return updateEvent(body);

      case 'deleteEvent':
        if (!isAdminOrMod(uid)) return error('Not authorized', 403);
        return deleteEvent(body.eventId);

      case 'createNews':
        if (!isAdminOrMod(uid)) return error('Not authorized', 403);
        return createNews(body);

      case 'updateNews':
        if (!isAdminOrMod(uid)) return error('Not authorized', 403);
        return updateNews(body);

      case 'deleteNews':
        if (!isAdminOrMod(uid)) return error('Not authorized', 403);
        return deleteNews(body.newsId);

      // ── ADMIN ONLY ────────────────────────────────
      case 'approveMember':
        if (!isAdmin(uid)) return error('Admin only', 403);
        return approveMember(body);

      case 'updateMemberTier':
        if (!isAdmin(uid)) return error('Admin only', 403);
        return updateMemberTier(body);

      case 'deleteMember':
        if (!isAdmin(uid)) return error('Admin only', 403);
        return deleteMember(body.memberId);

      case 'updateWelfareStats':
        if (!isAdmin(uid)) return error('Admin only', 403);
        return updateWelfareStats(body);

      case 'updateCommittee':
        if (!isAdmin(uid)) return error('Admin only', 403);
        return updateCommittee(body);


      default:
        return error('Unknown action: ' + action, 404);
    }
  } catch(err) {
    return error('Server error: ' + err.message, 500);
  }
}

// ══════════════════════════════════════════════════════════
//  AUTH HELPERS
//  Checks the Members sheet for the Firebase UID and role
// ══════════════════════════════════════════════════════════

function getMemberByUid(uid) {
  const sheet = getSheet(SHEET.MEMBERS);
  const data  = sheet.getDataRange().getValues();
  const headers = data[0];
  const uidCol  = headers.indexOf('firebase_uid');
  for (let i = 1; i < data.length; i++) {
    if (data[i][uidCol] === uid) {
      return rowToObj(headers, data[i]);
    }
  }
  return null;
}

function getTier(uid) {
  const m = getMemberByUid(uid);
  return m ? m.tier : 'public';
}

function isPaidOrAbove(uid) {
  return ['paid','admin','moderator'].includes(getTier(uid));
}

function isAdmin(uid) {
  return getTier(uid) === 'admin';
}

function isAdminOrMod(uid) {
  return ['admin','moderator'].includes(getTier(uid));
}

// ══════════════════════════════════════════════════════════
//  READ OPERATIONS
// ══════════════════════════════════════════════════════════

// ── EVENTS (public) ────────────────────────────────────────
// Returns upcoming events — accepts blank, 'published', or 'active' status.
// Also handles Google Sheets Date objects and serial numbers safely.
function getEvents() {
  const rows  = readSheet(SHEET.EVENTS);
  const today = new Date();
  today.setHours(0,0,0,0);

  function safeDate(val) {
    if (!val) return null;
    if (val instanceof Date) return val;
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }

  // Format using the SPREADSHEET's own timezone so the calendar date/time
  // matches exactly what is typed in the sheet. Using .getDate() (script TZ)
  // was causing an off-by-one day shift when script TZ != spreadsheet TZ.
  const TZ = SpreadsheetApp.getActive().getSpreadsheetTimeZone();

  function fmtDate(val) {
    if (!val) return '';
    if (val instanceof Date) return Utilities.formatDate(val, TZ, 'yyyy-MM-dd');
    return String(val);            // already a plain string like "2025-09-12"
  }

  // Time-only cells are stored by Sheets as a fraction of a day since the
  // 1899-12-30 epoch, so a raw read serializes to "1899-12-30T..Z". Formatting
  // to a plain time string ("12:00 PM") fixes that.
  function fmtTime(val) {
    if (!val) return '';
    if (val instanceof Date) return Utilities.formatDate(val, TZ, 'h:mm a');
    return String(val);            // already a plain string like "12:00 PM"
  }

  const upcoming = rows
    .filter(r => {
      // Accept published, active, or blank status
      const s = (r.status || '').toString().toLowerCase().trim();
      if (s && s !== 'published' && s !== 'active') return false;
      const d = safeDate(r.event_date);
      return d && d >= today;
    })
    .sort((a,b) => {
      const da = safeDate(a.event_date), db = safeDate(b.event_date);
      return (da || 0) - (db || 0);
    })
    .map(r => ({
      id:          r.id,
      title:       r.title,
      event_date:  fmtDate(r.event_date),
      event_time:  fmtTime(r.event_time),
      venue:       r.venue,
      city:        r.city,
      description: r.description,
      yapla_url:   r.yapla_url,
      capacity:    r.capacity,
      tag:         r.tag,
    }));

  return respond(upcoming);
}

// ── NEWS (public) ──────────────────────────────────────────
// Returns published news, newest first, max 20
function getNews() {
  const rows = readSheet(SHEET.NEWS);
  const news = rows
    .filter(r => r.published === 'TRUE' || r.published === true)
    .sort((a,b) => new Date(b.publish_date) - new Date(a.publish_date))
    .slice(0, 20)
    .map(r => ({
      id:           r.id,
      headline:     r.headline,
      summary:      r.summary,        // short preview (public)
      tag:          r.tag,            // promotion, award, event, obituary, welfare
      publish_date: r.publish_date,
      author:       r.author,
      // full_body only returned to paid members — omitted here
    }));

  return respond(news);
}

// ── COMMITTEE (public) ─────────────────────────────────────
function getCommittee() {
  const rows = readSheet(SHEET.COMMITTEE);
  const members = rows
    .filter(r => r.active === 'TRUE' || r.active === true)
    .sort((a,b) => Number(a.display_order) - Number(b.display_order))
    .map(r => ({
      id:            r.id,
      name:          r.name,
      role:          r.role,
      batch_year:    r.batch_year,
      photo_url:     r.photo_url,
      display_order: r.display_order,
    }));

  return respond(members);
}

// ── WELFARE STATS (public) ─────────────────────────────────
function getWelfareStats() {
  const rows = readSheet(SHEET.WELFARE);
  // Welfare sheet has a single data row (row 2) with current stats
  if (rows.length === 0) return respond({});
  const r = rows[0];
  return respond({
    fund_balance:       r.fund_balance,
    members_supported:  r.members_supported,
    active_scholarships:r.active_scholarships,
    total_disbursed:    r.total_disbursed,
    last_updated:       r.last_updated,
  });
}

// ── GALLERY (public) ───────────────────────────────────────
function getGallery() {
  const rows = readSheet(SHEET.GALLERY);
  const photos = rows
    .filter(r => r.published === 'TRUE' || r.published === true)
    .sort((a,b) => new Date(b.event_date) - new Date(a.event_date))
    .map(r => ({
      id:          r.id,
      title:       r.title,
      event_date:  r.event_date,
      photo_url:   r.photo_url,
      album_label: r.album_label,
    }));

  return respond(photos);
}

// ── DIRECTORY BASIC (free members) ────────────────────────
// Returns name, batch_year, city only — no email/phone
function getDirectoryBasic() {
  const rows = readSheet(SHEET.MEMBERS);
  const members = rows
    .filter(r => r.status === 'approved')
    .sort((a,b) => Number(a.batch_year) - Number(b.batch_year))
    .map(r => ({
      id:         r.id,
      name:       r.name,
      batch_year: r.batch_year,
      city:       r.city,
      province:   r.province,
      tier:       r.tier,
    }));

  return respond(members);
}

// ── DIRECTORY FULL (paid members) ─────────────────────────
// Returns everything except firebase_uid and internal notes
function getDirectoryFull() {
  const rows = readSheet(SHEET.MEMBERS);
  const members = rows
    .filter(r => r.status === 'approved')
    .sort((a,b) => Number(a.batch_year) - Number(b.batch_year))
    .map(r => ({
      id:           r.id,
      name:         r.name,
      batch_year:   r.batch_year,
      city:         r.city,
      province:     r.province,
      profession:   r.profession,
      employer:     r.employer,
      email:        r.email,
      phone:        r.phone,
      linkedin_url: r.linkedin_url,
      bio:          r.bio,
      tier:         r.tier,
      joined_date:  r.joined_date,
    }));

  return respond(members);
}

// ── SINGLE MEMBER PROFILE (paid members) ──────────────────
function getMemberProfile(memberId) {
  const rows = readSheet(SHEET.MEMBERS);
  const member = rows.find(r => r.id === memberId && r.status === 'approved');
  if (!member) return error('Member not found', 404);

  // Strip sensitive internal fields
  const { firebase_uid, internal_notes, ...safe } = member;
  return respond(safe);
}

// ── PENDING APPROVALS (admin) ─────────────────────────────
function getPending() {
  const rows = readSheet(SHEET.PENDING);
  return respond(rows);
}

// ── DASHBOARD STATS (admin/moderator) ─────────────────────
function getDashboardStats() {
  const members = readSheet(SHEET.MEMBERS);
  const events  = readSheet(SHEET.EVENTS);
  const news    = readSheet(SHEET.NEWS);
  const pending = readSheet(SHEET.PENDING);

  const total       = members.filter(r => r.status === 'approved').length;
  const paid        = members.filter(r => r.tier === 'paid').length;
  const free        = members.filter(r => r.tier === 'free').length;
  const byCity      = groupBy(members.filter(r=>r.status==='approved'), 'city');
  const byBatch     = groupBy(members.filter(r=>r.status==='approved'), 'batch_year');
  const upcomingEvt = events.filter(r => r.status === 'published' &&
                        new Date(r.event_date) >= new Date()).length;

  return respond({
    total_members:    total,
    paid_members:     paid,
    free_members:     free,
    pending_approvals:pending.length,
    upcoming_events:  upcomingEvt,
    total_news:       news.filter(r=>r.published==='TRUE').length,
    by_city:          byCity,
    by_batch:         byBatch,
  });
}

// ══════════════════════════════════════════════════════════
//  WRITE OPERATIONS
// ══════════════════════════════════════════════════════════

// ── REGISTER NEW MEMBER (public — on signup) ───────────────
// Firebase creates the user account first, then calls this
// to add them to the Pending sheet for committee approval
function registerMember(body) {
  const required = ['firebase_uid','name','email','batch_year','city'];
  for (const f of required) {
    if (!body[f]) return error('Missing field: ' + f, 400);
  }

  // Check for duplicate email in Members + Pending
  const existing = readSheet(SHEET.MEMBERS).find(r => r.email === body.email);
  const inPending = readSheet(SHEET.PENDING).find(r => r.email === body.email);
  if (existing || inPending) return error('Email already registered', 409);

  const id = generateId();
  const row = [
    id,
    body.firebase_uid,
    body.name,
    body.email,
    body.batch_year,
    body.city,
    body.province || '',
    body.profession || '',
    body.employer || '',
    body.phone || '',
    body.linkedin_url || '',
    body.bio || '',
    new Date().toISOString().split('T')[0], // submitted_date
    'pending',   // status — committee must approve
    '',          // notes
  ];

  getSheet(SHEET.PENDING).appendRow(row);

  // Send notification email to admin
  notifyAdmin(body.name, body.email, body.batch_year, body.city);

  return respond({ id, message: 'Registration submitted. You will be notified within 48 hours.' });
}

// ── APPROVE MEMBER (admin) ─────────────────────────────────
// Moves row from Pending → Members, sets tier = free
function approveMember(body) {
  const pendingSheet  = getSheet(SHEET.PENDING);
  const membersSheet  = getSheet(SHEET.MEMBERS);
  const pendingData   = pendingSheet.getDataRange().getValues();
  const headers       = pendingData[0];
  const idCol         = headers.indexOf('id');

  let foundRow = -1;
  for (let i = 1; i < pendingData.length; i++) {
    if (pendingData[i][idCol] === body.memberId) { foundRow = i + 1; break; }
  }

  if (foundRow === -1) return error('Pending member not found', 404);

  const pendingRow = pendingSheet.getRange(foundRow, 1, 1, pendingData[0].length).getValues()[0];
  const obj = rowToObj(headers, pendingRow);

  // Build Members row
  // Members columns: id, firebase_uid, name, email, batch_year, city, province,
  //   profession, employer, phone, linkedin_url, bio, joined_date,
  //   status, tier, internal_notes
  membersSheet.appendRow([
    obj.id,
    obj.firebase_uid,
    obj.name,
    obj.email,
    obj.batch_year,
    obj.city,
    obj.province || '',
    obj.profession || '',
    obj.employer || '',
    obj.phone || '',
    obj.linkedin_url || '',
    obj.bio || '',
    new Date().toISOString().split('T')[0],
    'approved',
    'free',      // starts as free member until dues paid
    body.notes || '',
  ]);

  // Remove from Pending
  pendingSheet.deleteRow(foundRow);

  // Email the applicant
  notifyApproved(obj.email, obj.name);

  return respond({ message: 'Member approved and moved to Members sheet.' });
}

// ── UPDATE MEMBER TIER (admin) ─────────────────────────────
// Called manually by admin after confirming Yapla payment
function updateMemberTier(body) {
  return updateSheetField(SHEET.MEMBERS, body.memberId, 'tier', body.tier);
}

// ── DELETE MEMBER (admin) ──────────────────────────────────
function deleteMember(memberId) {
  return deleteSheetRow(SHEET.MEMBERS, memberId);
}

// ── CREATE EVENT (admin/moderator) ────────────────────────
function createEvent(body) {
  const required = ['title','event_date','venue','city'];
  for (const f of required) {
    if (!body[f]) return error('Missing field: ' + f, 400);
  }

  const id = generateId();
  // Events columns: id, title, event_date, event_time, venue, city,
  //   description, yapla_url, capacity, tag, status, created_date, created_by
  getSheet(SHEET.EVENTS).appendRow([
    id,
    body.title,
    body.event_date,
    body.event_time || '',
    body.venue,
    body.city,
    body.description || '',
    body.yapla_url || '',
    body.capacity || '',
    body.tag || 'social',
    body.status || 'published',
    new Date().toISOString().split('T')[0],
    body.uid,
  ]);

  return respond({ id, message: 'Event created.' });
}

// ── UPDATE EVENT (admin/moderator) ────────────────────────
function updateEvent(body) {
  const fields = ['title','event_date','event_time','venue','city',
                  'description','yapla_url','capacity','tag','status'];
  return updateSheetRow(SHEET.EVENTS, body.eventId, body, fields);
}

// ── DELETE EVENT (admin/moderator) ────────────────────────
function deleteEvent(eventId) {
  return deleteSheetRow(SHEET.EVENTS, eventId);
}

// ── CREATE NEWS (admin/moderator) ─────────────────────────
function createNews(body) {
  const id = generateId();
  // News columns: id, headline, summary, full_body, tag,
  //   publish_date, author, published, created_by
  getSheet(SHEET.NEWS).appendRow([
    id,
    body.headline || '',
    body.summary  || '',
    body.full_body || '',
    body.tag      || 'news',
    body.publish_date || new Date().toISOString().split('T')[0],
    body.author   || '',
    body.published !== false ? 'TRUE' : 'FALSE',
    body.uid,
  ]);

  return respond({ id, message: 'News item created.' });
}

// ── UPDATE NEWS (admin/moderator) ─────────────────────────
function updateNews(body) {
  const fields = ['headline','summary','full_body','tag',
                  'publish_date','author','published'];
  return updateSheetRow(SHEET.NEWS, body.newsId, body, fields);
}

// ── DELETE NEWS (admin/moderator) ─────────────────────────
function deleteNews(newsId) {
  return deleteSheetRow(SHEET.NEWS, newsId);
}

// ── UPDATE WELFARE STATS (admin) ──────────────────────────
function updateWelfareStats(body) {
  const sheet = getSheet(SHEET.WELFARE);
  // Welfare is a single-row config sheet
  // Row 2 = the values row
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const fields  = ['fund_balance','members_supported','active_scholarships',
                   'total_disbursed','last_updated'];

  fields.forEach(f => {
    if (body[f] !== undefined) {
      const col = headers.indexOf(f) + 1;
      if (col > 0) sheet.getRange(2, col).setValue(body[f]);
    }
  });

  return respond({ message: 'Welfare stats updated.' });
}

// ── UPDATE COMMITTEE (admin) ───────────────────────────────
function updateCommittee(body) {
  // body.members = full array of committee members to overwrite
  const sheet = getSheet(SHEET.COMMITTEE);
  const headers = ['id','name','role','batch_year','photo_url','active','display_order'];

  // Clear existing data rows (keep header)
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, headers.length).clearContent();

  // Write new rows
  body.members.forEach((m, i) => {
    sheet.appendRow([
      m.id || generateId(),
      m.name, m.role, m.batch_year,
      m.photo_url || '', m.active || 'TRUE', m.display_order || (i + 1),
    ]);
  });

  return respond({ message: 'Committee updated.' });
}

// ── CONTACT FORM (public) ──────────────────────────────────
function contactForm(body) {
  // Just emails the admin — no sheet needed
  const adminEmail = getAdminEmail();
  if (adminEmail) {
    MailApp.sendEmail({
      to: adminEmail,
      subject: 'Remians Canada — Contact Form: ' + (body.subject || 'Message'),
      body: `From: ${body.name} <${body.email}>\n\n${body.message}`,
    });
  }
  return respond({ message: 'Message sent.' });
}

// ══════════════════════════════════════════════════════════
//  EMAIL NOTIFICATIONS
// ══════════════════════════════════════════════════════════

function getAdminEmail() {
  // Change this to your committee email address
  return 'admin@remians.ca';
}

function notifyAdmin(name, email, batch, city) {
  try {
    MailApp.sendEmail({
      to: getAdminEmail(),
      subject: 'New membership application — ' + name,
      body: `A new membership application has been submitted.\n\nName: ${name}\nEmail: ${email}\nBatch: ${batch}\nCity: ${city}\n\nLog in to the admin panel to review and approve.`,
    });
  } catch(e) { /* non-fatal */ }
}

function notifyApproved(email, name) {
  try {
    MailApp.sendEmail({
      to: email,
      subject: 'Welcome to Remians Canada!',
      body: `Dear ${name},\n\nYour membership application has been approved. You can now log in to remians.ca to access the member directory.\n\nTo unlock full access, please pay your annual dues via the member portal.\n\nWelcome to the family!\n\nRemians Canada Committee`,
    });
  } catch(e) { /* non-fatal */ }
}

// ══════════════════════════════════════════════════════════
//  SHEET UTILITIES
// ══════════════════════════════════════════════════════════

function getSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('Sheet not found: ' + name);
  return sheet;
}

function readSheet(name) {
  const sheet = getSheet(name);
  const data  = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  const headers = data[0];
  return data.slice(1).map(row => rowToObj(headers, row));
}

function rowToObj(headers, row) {
  const obj = {};
  headers.forEach((h, i) => { obj[h] = row[i]; });
  return obj;
}

function updateSheetField(sheetName, id, field, value) {
  const sheet   = getSheet(sheetName);
  const data    = sheet.getDataRange().getValues();
  const headers = data[0];
  const idCol   = headers.indexOf('id');
  const fCol    = headers.indexOf(field);

  if (fCol === -1) return error('Field not found: ' + field, 400);

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idCol]) === String(id)) {
      sheet.getRange(i + 1, fCol + 1).setValue(value);
      return respond({ message: 'Updated.' });
    }
  }
  return error('Row not found: ' + id, 404);
}

function updateSheetRow(sheetName, id, body, fields) {
  const sheet   = getSheet(sheetName);
  const data    = sheet.getDataRange().getValues();
  const headers = data[0];
  const idCol   = headers.indexOf('id');

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idCol]) === String(id)) {
      fields.forEach(f => {
        if (body[f] !== undefined) {
          const col = headers.indexOf(f);
          if (col > -1) sheet.getRange(i + 1, col + 1).setValue(body[f]);
        }
      });
      return respond({ message: 'Updated.' });
    }
  }
  return error('Row not found: ' + id, 404);
}

function deleteSheetRow(sheetName, id) {
  const sheet   = getSheet(sheetName);
  const data    = sheet.getDataRange().getValues();
  const headers = data[0];
  const idCol   = headers.indexOf('id');

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idCol]) === String(id)) {
      sheet.deleteRow(i + 1);
      return respond({ message: 'Deleted.' });
    }
  }
  return error('Row not found: ' + id, 404);
}

function groupBy(arr, key) {
  return arr.reduce((acc, obj) => {
    const k = obj[key] || 'Unknown';
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
}

function generateId() {
  return 'RC_' + new Date().getTime() + '_' + Math.random().toString(36).substr(2,5).toUpperCase();
}

// ══════════════════════════════════════════════════════════
//  ONE-TIME SETUP FUNCTION
//  Run this once manually to create all sheets with headers
//  In Apps Script editor: select setupSheets → Run
// ══════════════════════════════════════════════════════════

function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const schemas = {
    'Members': [
      'id','firebase_uid','name','email','batch_year','city','province',
      'profession','employer','phone','linkedin_url','bio',
      'joined_date','status','tier','internal_notes'
    ],
    'Pending': [
      'id','firebase_uid','name','email','batch_year','city','province',
      'profession','employer','phone','linkedin_url','bio',
      'submitted_date','status','notes'
    ],
    'Events': [
      'id','title','event_date','event_time','venue','city',
      'description','yapla_url','capacity','tag','status',
      'created_date','created_by'
    ],
    'News': [
      'id','headline','summary','full_body','tag',
      'publish_date','author','published','created_by'
    ],
    'Committee': [
      'id','name','role','batch_year','photo_url','active','display_order'
    ],
    'Welfare': [
      'fund_balance','members_supported','active_scholarships',
      'total_disbursed','last_updated'
    ],
    'Gallery': [
      'id','title','event_date','photo_url','album_label','published'
    ],
  };

  Object.entries(schemas).forEach(([name, headers]) => {
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
    }
    // Write headers in row 1
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    // Bold the header row
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    // Freeze header row
    sheet.setFrozenRows(1);
    // Auto-resize columns
    sheet.autoResizeColumns(1, headers.length);
  });

  // Seed Welfare with default values
  const welfare = ss.getSheetByName('Welfare');
  if (welfare.getLastRow() < 2) {
    welfare.appendRow([0, 0, 0, 0, new Date().toISOString().split('T')[0]]);
  }

  // Seed one sample event
  const events = ss.getSheetByName('Events');
  if (events.getLastRow() < 2) {
    events.appendRow([
      generateId(),
      'Annual Summer Picnic 2025',
      '2025-08-17', '12:00 PM',
      'Chinguacousy Park', 'Brampton',
      'Annual summer picnic for all Remians Canada members and families.',
      '', // yapla_url — add your Yapla link here
      '200', 'social', 'published',
      new Date().toISOString().split('T')[0],
      'admin'
    ]);
  }

  // Seed one sample news item
  const news = ss.getSheetByName('News');
  if (news.getLastRow() < 2) {
    news.appendRow([
      generateId(),
      'Welcome to the new Remians Canada website!',
      'We have launched our new digital home for all Canadian DRMC alumni.',
      'Full article body goes here...',
      'news',
      new Date().toISOString().split('T')[0],
      'Committee',
      'TRUE',
      'admin'
    ]);
  }

  Logger.log('✅ All sheets created successfully.');
  SpreadsheetApp.getUi().alert('Setup complete! All 7 sheets created with headers.');
}

// ══════════════════════════════════════════════════════════
//  RSVP SYSTEM
// ══════════════════════════════════════════════════════════

// RSVPs sheet columns:
// rsvp_id, event_id, firebase_uid, name, email,
// paid, etransfer_ref, adult_male, adult_female,
// kids_5_18_male, kids_5_18_female, age_0_5,
// need_ride, ride_persons, ride_postal,
// offer_ride, offer_seats, offer_postal,
// volunteer, bring_items, submitted_date

const RSVP_COLS = [
  'rsvp_id','event_id','firebase_uid','name','email',
  'paid','etransfer_ref',
  'adult_male','adult_female',
  'kids_5_18_male','kids_5_18_female','age_0_5',
  'need_ride','ride_persons','ride_postal',
  'offer_ride','offer_seats','offer_postal',
  'volunteer','bring_items','submitted_date'
];

function setupRsvpSheet() {
  const ss = SpreadsheetApp.getActive();
  if (!ss.getSheetByName('RSVPs')) {
    const s = ss.insertSheet('RSVPs');
    s.getRange(1, 1, 1, RSVP_COLS.length).setValues([RSVP_COLS]);
    s.setFrozenRows(1);
  }
}

function submitRsvp(body, uid) {
  if (!uid) return error('Not authenticated', 401);
  const member = getMemberByUid(uid);
  if (!member || member.status !== 'approved') return error('Not approved', 403);

  setupRsvpSheet();

  const ss    = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName('RSVPs');
  const TZ    = ss.getSpreadsheetTimeZone();

  // Check for duplicate RSVP (same uid + event)
  const existing = sheet.getDataRange().getValues();
  const headers  = existing[0];
  const uidCol   = headers.indexOf('firebase_uid');
  const evCol    = headers.indexOf('event_id');
  for (let i = 1; i < existing.length; i++) {
    if (existing[i][uidCol] === uid && existing[i][evCol] === body.event_id) {
      return error('Already RSVPd for this event', 409);
    }
  }

  const ref = body.paid === 'yes'
    ? (body.etransfer_ref || '').toString().trim()
    : body.etransfer_ref; // auto-generated ref passed from frontend

  const row = [
    generateId(),
    body.event_id        || '',
    uid,
    member.name          || body.name  || '',
    member.email         || body.email || '',
    body.paid            || 'no',
    ref                  || '',
    parseInt(body.adult_male)        || 1,
    parseInt(body.adult_female)      || 0,
    parseInt(body.kids_5_18_male)    || 0,
    parseInt(body.kids_5_18_female)  || 0,
    parseInt(body.age_0_5)           || 0,
    body.need_ride       || 'no',
    body.ride_persons    || '',
    body.ride_postal     || '',
    body.offer_ride      || 'no',
    body.offer_seats     || '',
    body.offer_postal    || '',
    body.volunteer       || 'no',
    body.bring_items     || '',
    Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss')
  ];

  sheet.appendRow(row);

  // ── Fee calculation (must mirror the frontend calcFee()) ──
  const adults = (parseInt(body.adult_male) || 0) + (parseInt(body.adult_female) || 0);
  const kids   = (parseInt(body.kids_5_18_male) || 0) + (parseInt(body.kids_5_18_female) || 0);
  const babies = parseInt(body.age_0_5) || 0;
  const fee    = (adults * 30) + (kids * 20);

  // ── Confirmation email (non-fatal: an email failure must not lose the RSVP) ──
  try {
    sendRsvpEmail({
      to:      member.email || body.email,
      name:    member.name  || body.name,
      event:   getEventTitle(body.event_id),
      paid:    body.paid,
      ref:     ref,
      adults:  adults,
      kids:    kids,
      babies:  babies,
      fee:     fee
    });
  } catch (mailErr) {
    Logger.log('RSVP email failed: ' + mailErr);
  }

  return respond({
    ok: true,
    message: 'RSVP submitted successfully',
    reference: ref,
    fee: fee
  });
}

function getEventTitle(eventId) {
  try {
    const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET.EVENTS);
    const data  = sheet.getDataRange().getValues();
    const idCol = data[0].indexOf('id');
    const tiCol = data[0].indexOf('title');
    for (let i = 1; i < data.length; i++) {
      if (data[i][idCol] === eventId) return data[i][tiCol];
    }
  } catch (e) {}
  return 'the event';
}

function sendRsvpEmail(o) {
  if (!o.to) return;

  const party = [
    o.adults + ' adult' + (o.adults === 1 ? '' : 's'),
    o.kids   ? o.kids   + ' child' + (o.kids   === 1 ? '' : 'ren') + ' (5–18)' : null,
    o.babies ? o.babies + ' child' + (o.babies === 1 ? '' : 'ren') + ' (0–5, free)' : null
  ].filter(Boolean).join(', ');

  const paidLine = o.paid === 'yes'
    ? 'You indicated the e-Transfer has already been sent, with reference <b>' + o.ref + '</b>.'
    : 'Please send your e-Transfer of <b>$' + o.fee + '</b> to <b>remians.ca@gmail.com</b> and use ' +
      '<b>' + o.ref + '</b> as the message/reference. Set the security answer to <b>DRMC</b>.';

  const html =
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#231F20;line-height:1.6">' +
      '<p>Dear ' + (o.name || 'Remian') + ',</p>' +
      '<p>We have received your registration for <b>' + o.event + '</b>.</p>' +
      '<div style="background:#F7F2E7;border-left:4px solid #009444;padding:14px 18px;margin:18px 0">' +
        '<div><b>Party:</b> ' + party + '</div>' +
        '<div><b>Registration fee:</b> $' + o.fee + '</div>' +
        '<div><b>Reference number:</b> ' + o.ref + '</div>' +
      '</div>' +
      '<p>' + paidLine + '</p>' +
      '<p style="background:#FBE7E2;padding:12px 16px;border-radius:6px">' +
        '<b>Your registration will be confirmed once the e-Transfer is received.</b>' +
      '</p>' +
      '<p>Any amount above the registration fee is gratefully received as a donation. ' +
      'If you send from an email address other than your login email, please let us know separately.</p>' +
      '<p>Warm regards,<br>Remians Canada</p>' +
    '</div>';

  GmailApp.sendEmail(o.to, 'Registration received — ' + o.event, '', {
    htmlBody: html,
    name:     'Remians Canada'
  });
}

function checkRsvp(eventId, uid) {
  if (!uid || !eventId) return respond({ rsvpd: false });
  setupRsvpSheet();
  const ss      = SpreadsheetApp.getActive();
  const sheet   = ss.getSheetByName('RSVPs');
  const data    = sheet.getDataRange().getValues();
  const headers = data[0];
  const uidCol  = headers.indexOf('firebase_uid');
  const evCol   = headers.indexOf('event_id');
  for (let i = 1; i < data.length; i++) {
    if (data[i][uidCol] === uid && data[i][evCol] === eventId) {
      return respond({ rsvpd: true });
    }
  }
  return respond({ rsvpd: false });
}
