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

  // ── REPLACE THIS with your deployed Apps Script URL ──────
  const BASE_URL = 'https://script.google.com/macros/s/AKfycbwA0Vl3cW-8mJU1lxBBXbz41R3tBjyA4rlKFA__syOcd96GWxPxwMr_56KusQBEzqMHPQ/exec';

  // ── Internal fetch helpers ────────────────────────────────
  async function get(params = {}) {
    const url = new URL(BASE_URL);
    Object.entries(params).forEach(([k,v]) => url.searchParams.set(k, v));
    const res  = await fetch(url.toString());
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'API error');
    return json.data;
  }

  async function post(body = {}) {
    const res  = await fetch(BASE_URL, {
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
    if (!uid) return 'public';
    try { return (await get({ action: 'getMemberTier', uid }))?.tier || 'free'; }
    catch(e) { return 'free'; }
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
  return {
    // Public
    getEvents, getNews, getCommittee,
    getWelfareStats, getGallery,
    registerMember, contactForm,
    // Free member
    getMemberTier, getDirectoryBasic,
    // Paid member
    getDirectoryFull, getMemberProfile,
    // Moderator
    createEvent, updateEvent, deleteEvent,
    createNews, updateNews, deleteNews,
    // Admin
    getPending, getDashboardStats,
    approveMember, updateMemberTier, deleteMember,
    updateWelfareStats, updateCommittee,
  };
})();
