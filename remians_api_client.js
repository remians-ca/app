/**
 * ============================================================
 *  REMIANS CANADA — Frontend API Client
 *  Include this file in your HTML site BEFORE your main script.
 *  Replace APPS_SCRIPT_URL with your deployed web app URL.
 *
 *  Usage examples:
 *    const events = await API.getEvents();
 *    const ok     = await API.registerMember({...});
 *    const dir    = await API.getDirectoryFull(firebaseUID);
 * ============================================================
 */

const API = (() => {

  // ── Apps Script deployment URL ───────────────────────────
  const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyo3cjzXw6760cjYTib-3UY2lsGUSdYAKCs4R8g0n_VAS4pwAzsGxl6FL8dIiSpzZZb6w/exec';

  // ── CORS proxy toggle ────────────────────────────────────
  // true  = route through cors-anywhere (requires opt-in at
  //         https://cors-anywhere.herokuapp.com/corsdemo, expires periodically)
  // false = talk to Apps Script directly (correct once the script is deployed
  //         as Web app / Execute as Me / Access: Anyone)
  const USE_PROXY = false;
  const PROXY     = 'https://cors-anywhere.herokuapp.com/';

  const BASE_URL = USE_PROXY ? PROXY + SCRIPT_URL : SCRIPT_URL;

  // ── Identity ──────────────────────────────────────────────
  // The Apps Script derives the caller's identity from this token,
  // not from any uid we send. Returns '' when signed out.
  async function idToken() {
    try {
      const u = window.firebase && firebase.auth && firebase.auth().currentUser;
      return u ? await u.getIdToken() : '';
    } catch (e) {
      // Silently returning '' here sends an unauthenticated request that the
      // server answers with 401 - a failure that looks nothing like its cause.
      console.warn('[api] could not obtain ID token:', e && e.message);
      return '';
    }
  }

  // ── Internal fetch helpers ────────────────────────────────
  // Routes that need no identity at all. Sending a token with these made the
  // server verify it once per call - five extra round trips to Google on every
  // page load, all racing each other.
  const PUBLIC_ACTIONS = new Set([
    'getEvents', 'getNews', 'getCommittee', 'getWelfareStats', 'getGallery'
  ]);

  async function get(params = {}) {
    const url = new URL(BASE_URL);
    Object.entries(params).forEach(([k,v]) => url.searchParams.set(k, v));
    if (!PUBLIC_ACTIONS.has(params.action)) {
      const t = await idToken();
      if (t) url.searchParams.set('idToken', t);
    }
    const res  = await fetch(url.toString());
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'API error');
    return json.data;
  }

  async function post(body = {}) {
    const t   = await idToken();
    const url = new URL(BASE_URL);
    if (t) url.searchParams.set('idToken', t);
    const res  = await fetch(url.toString(), {
      method: 'POST',
      body:   JSON.stringify(body),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'API error');
    return json.data;
  }

  // ── Get current Firebase UID from auth state ──────────────
  // Returns null if not logged in
  function getUID() {
    try {
      return firebase.auth().currentUser?.uid || null;
    } catch {
      return null;
    }
  }

  // ════════════════════════════════════════════════════════
  //  PUBLIC ENDPOINTS (no auth required)
  // ════════════════════════════════════════════════════════

  /** Fetch all upcoming published events */
  async function getEvents() {
    return get({ action: 'getEvents' });
  }

  /** Fetch latest published news (max 20) */
  async function getNews() {
    return get({ action: 'getNews' });
  }

  /** Fetch active committee members */
  async function getCommittee() {
    return get({ action: 'getCommittee' });
  }

  /** Fetch welfare fund display stats */
  async function getWelfareStats() {
    return get({ action: 'getWelfareStats' });
  }

  /** Fetch published photo gallery */
  async function getGallery() {
    return get({ action: 'getGallery' });
  }

  /** Submit new member registration (creates Firebase account first) */
  async function registerMember(data) {
    // data: { firebase_uid, name, email, batch_year, city, province?,
    //         profession?, employer?, phone?, linkedin_url?, bio? }
    return post({ action: 'registerMember', ...data });
  }

  /** Submit contact form message */
  async function contactForm(data) {
    // data: { name, email, subject, message }
    return post({ action: 'contactForm', ...data });
  }

  /** Get a member's tier by Firebase UID — called on every login */
  async function getMemberTier(uid) {
    if (!uid) return { tier: 'public', status: 'unknown' };
    // Deliberately does NOT catch. Swallowing the error here turned a transient
    // network failure into status:'pending', which Gate 2 reads as "not approved"
    // and signs the member out. Let it throw so firebase_auth.js can retry and
    // then degrade, keeping the session alive.
    const r = await get({ action: 'getMemberTier', uid });
    return {
      tier:   String(r?.tier   || 'free').trim().toLowerCase(),
      status: String(r?.status || 'pending').trim().toLowerCase(),
    };
  }

  /** Diagnostic: what the server thinks about the caller's identity + sheet row */
  async function whoAmI() {
    return get({ action: 'whoAmI', uid: getUID() || '' });
  }

  // ════════════════════════════════════════════════════════
  //  FREE MEMBER ENDPOINTS (must be logged in)
  // ════════════════════════════════════════════════════════

  /** Fetch basic directory: name, batch, city only */
  async function getDirectoryBasic() {
    const uid = getUID();
    if (!uid) throw new Error('Please log in to view the directory.');
    return get({ action: 'getDirectoryBasic', uid });
  }

  // ════════════════════════════════════════════════════════
  //  PAID MEMBER ENDPOINTS
  // ════════════════════════════════════════════════════════

  /** Fetch full directory with email, phone, profession */
  async function getDirectoryFull() {
    const uid = getUID();
    if (!uid) throw new Error('Please log in.');
    return get({ action: 'getDirectoryFull', uid });
  }

  /** Fetch a single member's full profile */
  async function getMemberProfile(memberId) {
    const uid = getUID();
    if (!uid) throw new Error('Please log in.');
    return get({ action: 'getMemberProfile', uid, memberId });
  }

  // ════════════════════════════════════════════════════════
  //  MODERATOR ENDPOINTS
  // ════════════════════════════════════════════════════════

  async function createEvent(data) {
    return post({ action: 'createEvent', uid: getUID(), ...data });
  }

  async function updateEvent(eventId, data) {
    return post({ action: 'updateEvent', uid: getUID(), eventId, ...data });
  }

  async function deleteEvent(eventId) {
    return post({ action: 'deleteEvent', uid: getUID(), eventId });
  }

  async function createNews(data) {
    return post({ action: 'createNews', uid: getUID(), ...data });
  }

  async function updateNews(newsId, data) {
    return post({ action: 'updateNews', uid: getUID(), newsId, ...data });
  }

  async function deleteNews(newsId) {
    return post({ action: 'deleteNews', uid: getUID(), newsId });
  }

  // ════════════════════════════════════════════════════════
  //  ADMIN ENDPOINTS
  // ════════════════════════════════════════════════════════

  async function getPending() {
    return get({ action: 'getPending', uid: getUID() });
  }

  async function getDashboardStats() {
    return get({ action: 'getDashboardStats', uid: getUID() });
  }

  async function approveMember(memberId, notes = '') {
    return post({ action: 'approveMember', uid: getUID(), memberId, notes });
  }

  async function updateMemberTier(memberId, tier) {
    // tier: 'free' | 'paid' | 'moderator' | 'admin'
    return post({ action: 'updateMemberTier', uid: getUID(), memberId, tier });
  }

  async function deleteMember(memberId) {
    return post({ action: 'deleteMember', uid: getUID(), memberId });
  }

  async function updateWelfareStats(data) {
    return post({ action: 'updateWelfareStats', uid: getUID(), ...data });
  }

  async function updateCommittee(members) {
    return post({ action: 'updateCommittee', uid: getUID(), members });
  }

  // ════════════════════════════════════════════════════════
  //  PUBLIC SURFACE
  // ════════════════════════════════════════════════════════
  // ── Diagnostic ──────────────────────────────────────────
  async function authCheck() { return get({ action: 'authCheck' }); }

  // ── RSVP ────────────────────────────────────────────────
  async function submitRsvp(data) {
    // Use GET with query parameters to avoid CORS preflight (POST with JSON triggers preflight)
    return get({ action: 'submitRsvp', ...data });
  }
  async function checkRsvp(eventId, uid) {
    if (!eventId || !uid) return { rsvpd: false };
    return get({ action: 'checkRsvp', event_id: eventId, uid });
  }
  /** All event_ids the caller has already registered for — one call, not one per event */
  async function getMyRsvps() {
    const uid = getUID();
    if (!uid) return [];
    return get({ action: 'getMyRsvps', uid });
  }

  return {
    // Public
    getEvents, getNews, getCommittee,
    getWelfareStats, getGallery,
    registerMember, contactForm,
    // Free member
    getMemberTier, getDirectoryBasic,
    // Paid member
    getDirectoryFull, getMemberProfile,
    // RSVP
    submitRsvp, checkRsvp, getMyRsvps,
    // Diagnostic
    authCheck, whoAmI,
    // Moderator
    createEvent, updateEvent, deleteEvent,
    createNews, updateNews, deleteNews,
    // Admin
    getPending, getDashboardStats,
    approveMember, updateMemberTier, deleteMember,
    updateWelfareStats, updateCommittee,
  };
})();

// Explicit global export — a top-level `const` is script-scoped, so this
// guarantees API resolves from later scripts regardless of load quirks.
window.API = API;
