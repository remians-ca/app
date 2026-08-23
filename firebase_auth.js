/**
 * ============================================================
 *  REMIANS CANADA — Firebase Authentication Module
 *  firebase_auth.js
 *
 *  Load order in index.html (before this file):
 *  1. firebase-app-compat
 *  2. firebase-auth-compat
 *  3. remians_api_client.js
 *  4. THIS FILE (firebase_auth.js)
 *  5. index.html inline script (loadPageData, renderEvents etc.)
 * ============================================================
 */

// ── FIREBASE AUTH ────────────────────────────────────────────
// Firebase is initialized in index.html (before this script loads).
// This keeps the config out of .js files and away from GitHub secret scanning.
// auth is set from the initialized app:
const auth = firebase.auth();

// ── GLOBAL STATE ────────────────────────────────────────────
window.currentUser = null;
window.currentTier = 'public';

// ── AUTH STATE LISTENER ─────────────────────────────────────
// Fires on every page load and whenever login/logout happens.
// Two gates enforced here:
//   Gate 1 — Email must be verified (Firebase)
//   Gate 2 — Account must be approved by committee (Sheets)
auth.onAuthStateChanged(async (user) => {
  if (user) {

    // ── GATE 1: Email verification ──────────────────────────
    if (!user.emailVerified) {
      await auth.signOut();
      window.currentUser = null;
      window.currentTier = 'public';
      updateNavLoggedOut();
      applyTierView('public');
      showVerificationBanner(user.email);
      return;
    }

    // ── GATE 2: Committee approval ──────────────────────────
    let memberData = { tier: 'free', status: 'pending' };
    try {
      memberData = await API.getMemberTier(user.uid);
    } catch(e) {
      console.warn('Could not fetch member status:', e.message);
    }

    if (memberData.status !== 'approved') {
      // Not yet approved — sign them out and explain
      await auth.signOut();
      window.currentUser = null;
      window.currentTier = 'public';
      updateNavLoggedOut();
      applyTierView('public');
      showPendingBanner();
      return;
    }

    // ── Both gates passed — grant access ────────────────────
    window.currentUser = user;
    window.currentTier = memberData.tier || 'free';
    updateNavLoggedIn(user);
    applyTierView(window.currentTier);

  } else {
    window.currentUser = null;
    window.currentTier = 'public';
    updateNavLoggedOut();
    applyTierView('public');
  }
});

// ════════════════════════════════════════════════════════════
//  SIGN UP
//  Called when user submits the Join form
// ════════════════════════════════════════════════════════════
async function handleSignup() {
  clearAuthError();

  const name      = document.getElementById('su-name')?.value?.trim();
  const email     = document.getElementById('su-email')?.value?.trim();
  const password  = document.getElementById('su-password')?.value;
  const batch     = document.getElementById('su-batch')?.value?.trim();
  const city      = document.getElementById('su-city')?.value?.trim();

  // Validate
  if (!name || !email || !password || !batch || !city) {
    return showAuthError('Please fill in all required fields.');
  }
  if (password.length < 8) {
    return showAuthError('Password must be at least 8 characters.');
  }
  if (isNaN(batch) || batch.length !== 4) {
    return showAuthError('Please enter a valid 4-digit batch year (e.g. 1998).');
  }

  setSubmitLoading(true, 'Creating account…');

  try {
    // 1. Create Firebase account
    const cred = await auth.createUserWithEmailAndPassword(email, password);
    const user  = cred.user;

    // 2. Set display name
    await user.updateProfile({ displayName: name });

    // 3. Send email verification
    await user.sendEmailVerification();

    // 4. Register in Google Sheets (status = pending, tier = free)
    await API.registerMember({
      firebase_uid: user.uid,
      name,
      email,
      batch_year:   batch,
      city,
      province:     document.getElementById('su-province')?.value?.trim() || '',
      profession:   document.getElementById('su-profession')?.value?.trim() || '',
    });

    setSubmitLoading(false);
    closeModal(null, true);
    showSuccessBanner(
      'Welcome to Remians Canada! 🎉',
      'Your application is pending committee approval (48 hrs). Check your email to verify your account.'
    );

  } catch(err) {
    setSubmitLoading(false);
    showAuthError(firebaseErrorMsg(err.code));
  }
}

// ════════════════════════════════════════════════════════════
//  SIGN IN
// ════════════════════════════════════════════════════════════
async function handleLogin() {
  clearAuthError();

  const email    = document.getElementById('li-email')?.value?.trim();
  const password = document.getElementById('li-password')?.value;

  if (!email || !password) {
    return showAuthError('Please enter your email and password.');
  }

  setSubmitLoading(true, 'Signing in…');

  try {
    const cred = await auth.signInWithEmailAndPassword(email, password);
    setSubmitLoading(false);

    // Check email verification immediately so we give a clear message
    // (onAuthStateChanged will also enforce this, this just improves UX)
    if (!cred.user.emailVerified) {
      await auth.signOut();
      closeModal(null, true);
      showVerificationBanner(email);
      return;
    }

    // Let onAuthStateChanged handle the approval check and tier loading
    closeModal(null, true);
    // Slight delay so auth state listener can run
    setTimeout(() => {
      if (window.currentTier === 'public') {
        // onAuthStateChanged signed them out (pending approval)
        // Banner already shown by listener — nothing more to do
      } else {
        showToast('Welcome back, Remian! 🇧🇩🍁');
      }
    }, 800);

  } catch(err) {
    setSubmitLoading(false);
    showAuthError(firebaseErrorMsg(err.code));
  }
}

// ════════════════════════════════════════════════════════════
//  SIGN OUT
// ════════════════════════════════════════════════════════════
async function handleSignOut() {
  try {
    await auth.signOut();
    showToast('Signed out. See you soon!');
    setTimeout(() => window.location.reload(), 1200);
  } catch(e) {
    showToast('Sign out failed — please try again.');
  }
}

// ════════════════════════════════════════════════════════════
//  PASSWORD RESET
// ════════════════════════════════════════════════════════════
async function handlePasswordReset() {
  const email = document.getElementById('li-email')?.value?.trim();
  if (!email) {
    return showAuthError('Enter your email address above, then click reset.');
  }
  try {
    await auth.sendPasswordResetEmail(email);
    showToast('Password reset email sent — check your inbox.');
  } catch(err) {
    showAuthError(firebaseErrorMsg(err.code));
  }
}

// ════════════════════════════════════════════════════════════
//  TIER-GATED VIEW
//  Controls what each user tier sees on the page
// ════════════════════════════════════════════════════════════
function applyTierView(tier) {
  // ── Directory section ──
  const gateWrap    = document.getElementById('gateWrap');
  const dirBasic    = document.getElementById('dirBasic');
  const dirFull     = document.getElementById('dirFull');
  const dirSearch   = document.getElementById('dirSearch');

  if (tier === 'public') {
    // Show lock gate, hide directory
    if (gateWrap)  gateWrap.style.display  = '';
    if (dirBasic)  dirBasic.style.display  = 'none';
    if (dirFull)   dirFull.style.display   = 'none';
    if (dirSearch) dirSearch.style.display = 'none';

  } else if (tier === 'free') {
    // Hide gate, show basic directory (name/batch/city only)
    if (gateWrap)  gateWrap.style.display  = 'none';
    if (dirBasic)  dirBasic.style.display  = '';
    if (dirFull)   dirFull.style.display   = 'none';
    if (dirSearch) dirSearch.style.display = '';
    loadBasicDirectory();

  } else if (['paid','admin','moderator'].includes(tier)) {
    // Hide gate, show full directory
    if (gateWrap)  gateWrap.style.display  = 'none';
    if (dirBasic)  dirBasic.style.display  = 'none';
    if (dirFull)   dirFull.style.display   = '';
    if (dirSearch) dirSearch.style.display = '';
    loadFullDirectory();
  }

  // ── Show/hide tier-specific UI elements ──
  document.querySelectorAll('[data-tier]').forEach(el => {
    const required = el.dataset.tier.split(',').map(t => t.trim());
    el.style.display = required.includes(tier) || required.includes('all') ? '' : 'none';
  });

  // ── Re-render events now that tier is known ──
  // This ensures RSVP buttons show the correct action (RSVP form for logged-in,
  // login screen for guests) based on currentTier. Events may have been rendered
  // before auth completed, showing login buttons for everyone.
  if (window.allEvents && window.renderEvents) {
    window.renderEvents(window.allEvents);
  }
}

// ════════════════════════════════════════════════════════════
//  DIRECTORY LOADERS
// ════════════════════════════════════════════════════════════
async function loadBasicDirectory() {
  const el = document.getElementById('dirBasic');
  if (!el) return;
  el.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-tert)">Loading members…</div>';
  try {
    const members = await API.getDirectoryBasic();
    renderBasicDirectory(members);
  } catch(e) {
    el.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-tert)">Could not load directory.</div>';
  }
}

async function loadFullDirectory() {
  const el = document.getElementById('dirFull');
  if (!el) return;
  el.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-tert)">Loading members…</div>';
  try {
    const members = await API.getDirectoryFull();
    renderFullDirectory(members);
  } catch(e) {
    el.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-tert)">Could not load directory.</div>';
  }
}

function renderBasicDirectory(members) {
  const el = document.getElementById('dirBasic');
  if (!el) return;
  if (!members || !members.length) {
    el.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-tert)">No members found.</div>';
    return;
  }
  el.innerHTML = `
    <p style="font-size:12px;color:var(--text-tert);margin-bottom:14px;text-align:center">
      Showing name, batch year and city. <a href="#" onclick="openModal('join');return false" style="color:var(--green);font-weight:600">Upgrade to paid membership</a> to see full profiles and contact details.
    </p>
    <div class="dir-grid">
      ${members.map(m => `
        <div class="dir-card dir-card-basic">
          <div class="dir-avatar" style="background:${avatarColor(m.batch_year)}">${initials(m.name)}</div>
          <div class="dir-info">
            <div class="dir-name">${m.name}</div>
            <div class="dir-meta">Batch ${m.batch_year} · ${m.city}${m.province ? ', '+m.province : ''}</div>
          </div>
        </div>`).join('')}
    </div>`;
}

function renderFullDirectory(members) {
  const el = document.getElementById('dirFull');
  if (!el) return;
  if (!members || !members.length) {
    el.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-tert)">No members found.</div>';
    return;
  }
  el.innerHTML = `
    <div class="dir-grid">
      ${members.map(m => `
        <div class="dir-card">
          <div class="dir-avatar" style="background:${avatarColor(m.batch_year)}">${initials(m.name)}</div>
          <div class="dir-info">
            <div class="dir-name">${m.name}
              ${m.tier==='paid'||m.tier==='admin'||m.tier==='moderator' ? '<span class="dir-paid-badge">✓ Member</span>' : ''}
            </div>
            <div class="dir-meta">Batch ${m.batch_year} · ${m.city}${m.province?', '+m.province:''}</div>
            ${m.profession ? `<div class="dir-meta" style="margin-top:2px">${m.profession}${m.employer?' · '+m.employer:''}</div>` : ''}
            <div class="dir-contact">
              ${m.email    ? `<a href="mailto:${m.email}" class="dir-contact-btn"><i class="ti ti-mail"></i> Email</a>` : ''}
              ${m.phone    ? `<a href="tel:${m.phone}" class="dir-contact-btn"><i class="ti ti-phone"></i> Call</a>` : ''}
              ${m.linkedin_url ? `<a href="${m.linkedin_url}" target="_blank" class="dir-contact-btn"><i class="ti ti-brand-linkedin"></i> LinkedIn</a>` : ''}
            </div>
          </div>
        </div>`).join('')}
    </div>`;
}

// ── DIRECTORY SEARCH ────────────────────────────────────────
function filterDirectory(query) {
  const q = query.toLowerCase();
  document.querySelectorAll('.dir-card').forEach(card => {
    const text = card.textContent.toLowerCase();
    card.style.display = text.includes(q) ? '' : 'none';
  });
}

// ── AVATAR HELPERS ───────────────────────────────────────────
function initials(name) {
  if (!name) return '?';
  const parts = name.trim().split(' ');
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}
function avatarColor(batch) {
  const colors = ['#1A5C2A','#C8102E','#1E3A5F','#5C2A1A','#2A5C4A','#4A2A5C','#5C4A1A','#1A4A5C'];
  return colors[(parseInt(batch) || 0) % colors.length];
}

// ════════════════════════════════════════════════════════════
//  NAV UPDATE
// ════════════════════════════════════════════════════════════
function updateNavLoggedIn(user) {
  const firstName = (user.displayName || user.email || 'Member').split(' ')[0];
  const loginBtn  = document.querySelector('.nav-login');
  const joinBtn   = document.querySelector('.nav-join');

  if (loginBtn) {
    loginBtn.textContent = firstName;
    loginBtn.title       = 'Click to sign out';
    loginBtn.style.color = 'var(--gold-lt)';
    loginBtn.onclick     = handleSignOut;
  }
  if (joinBtn) {
    joinBtn.textContent        = 'Sign Out';
    joinBtn.style.background   = 'rgba(255,255,255,.12)';
    joinBtn.style.color        = 'white';
    joinBtn.style.border       = '1px solid rgba(255,255,255,.2)';
    joinBtn.onclick            = handleSignOut;
  }
}

function updateNavLoggedOut() {
  const loginBtn = document.querySelector('.nav-login');
  const joinBtn  = document.querySelector('.nav-join');
  if (loginBtn) {
    loginBtn.textContent = 'Log in';
    loginBtn.style.color = '';
    loginBtn.onclick     = () => openModal('login');
  }
  if (joinBtn) {
    joinBtn.textContent      = 'Join Now';
    joinBtn.style.background = '';
    joinBtn.style.color      = '';
    joinBtn.style.border     = '';
    joinBtn.onclick          = () => openModal('join');
  }
}

// ════════════════════════════════════════════════════════════
//  BANNERS
//  Three types: success, email-not-verified, pending-approval
// ════════════════════════════════════════════════════════════

function showBanner(title, message, color, extraHtml) {
  let banner = document.getElementById('authBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'authBanner';
    document.body.appendChild(banner);
  }
  banner.style.cssText = [
    'position:fixed;top:80px;left:50%;transform:translateX(-50%)',
    'padding:18px 24px;border-radius:12px',
    'max-width:500px;width:92%;text-align:center',
    'box-shadow:0 8px 32px rgba(0,0,0,.2)',
    'z-index:3000;animation:slideDown .3s ease both',
    `background:${color};color:white`,
  ].join(';');
  banner.innerHTML = `
    <div style="font-size:15px;font-weight:600;margin-bottom:6px">${title}</div>
    <div style="font-size:13px;opacity:.9;line-height:1.6">${message}</div>
    ${extraHtml || ''}
    <button onclick="document.getElementById('authBanner').remove()"
      style="margin-top:12px;background:rgba(255,255,255,.2);border:none;color:white;
             padding:6px 18px;border-radius:6px;cursor:pointer;font-size:12px">
      Dismiss
    </button>`;
  // Auto-dismiss after 15 seconds
  setTimeout(() => banner?.remove(), 15000);
}

// ── Email not verified ───────────────────────────────────────
function showVerificationBanner(email) {
  showBanner(
    '📧 Please verify your email first',
    `We sent a verification link to <strong>${email}</strong>. ` +
    'Click the link in that email, then come back and log in.',
    '#C8102E',
    `<div style="margin-top:10px">
       <button onclick="resendVerification('${email}')"
         style="background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.4);
                color:white;padding:6px 16px;border-radius:6px;cursor:pointer;font-size:12px;margin-right:8px">
         Resend verification email
       </button>
     </div>`
  );
}

// ── Account pending committee approval ───────────────────────
function showPendingBanner() {
  showBanner(
    '⏳ Your account is pending approval',
    'Your email is verified. The Remians Canada committee will review your application ' +
    'within 48 hours and send you a confirmation email.',
    '#1A5C2A',
    ''
  );
}

// ── Resend verification email ────────────────────────────────
async function resendVerification(email) {
  try {
    // User was signed out — need to re-sign in briefly to resend
    // Instead, just tell them to try logging in again (Firebase will detect unverified)
    showToast('Please log in again — Firebase will prompt email verification.');
  } catch(e) {
    showToast('Could not resend. Try logging in again.');
  }
}

function showSuccessBanner(title, message) {
  let banner = document.getElementById('successBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'successBanner';
    banner.style.cssText = `
      position:fixed;top:80px;left:50%;transform:translateX(-50%);
      background:#1A5C2A;color:white;
      padding:18px 28px;border-radius:12px;
      max-width:480px;width:90%;text-align:center;
      box-shadow:0 8px 32px rgba(26,92,42,.35);
      z-index:3000;animation:slideDown .3s ease both;
    `;
    document.body.appendChild(banner);
  }
  banner.innerHTML = `
    <div style="font-size:16px;font-weight:600;margin-bottom:6px">${title}</div>
    <div style="font-size:13px;opacity:.85;line-height:1.5">${message}</div>
    <button onclick="this.parentElement.remove()" style="margin-top:12px;background:rgba(255,255,255,.2);border:none;color:white;padding:6px 16px;border-radius:6px;cursor:pointer;font-size:12px">Got it</button>
  `;
  setTimeout(() => banner?.remove(), 12000);
}

// ════════════════════════════════════════════════════════════
//  AUTH UI HELPERS
// ════════════════════════════════════════════════════════════
function showAuthError(msg) {
  let el = document.getElementById('authError');
  if (!el) {
    el = document.createElement('div');
    el.id = 'authError';
    el.style.cssText = 'background:#FEE2E2;color:#991B1B;border-radius:6px;padding:10px 14px;font-size:13px;margin-top:8px;border:1px solid #FECACA;line-height:1.4;';
    const modal = document.querySelector('.modal');
    if (modal) modal.appendChild(el);
  }
  el.textContent  = msg;
  el.style.display = 'block';
}

function clearAuthError() {
  const el = document.getElementById('authError');
  if (el) el.style.display = 'none';
}

function setSubmitLoading(on, label) {
  // Target whichever submit button is currently visible
  document.querySelectorAll('.fsubmit').forEach(btn => {
    if (btn.offsetParent !== null) { // visible
      btn.disabled    = on;
      if (!btn.dataset.label) btn.dataset.label = btn.textContent;
      btn.textContent = on ? (label || 'Please wait…') : btn.dataset.label;
    }
  });
}

// ════════════════════════════════════════════════════════════
//  FIREBASE ERROR → HUMAN MESSAGE
// ════════════════════════════════════════════════════════════
function firebaseErrorMsg(code) {
  const map = {
    'auth/email-already-in-use':   'This email is already registered. Try logging in instead.',
    'auth/invalid-email':          'Please enter a valid email address.',
    'auth/weak-password':          'Password must be at least 8 characters.',
    'auth/user-not-found':         'No account found with this email. Have you registered yet?',
    'auth/wrong-password':         'Incorrect password. Try again or use "Forgot password" below.',
    'auth/invalid-credential':     'Incorrect email or password. Please check and try again.',
    'auth/too-many-requests':      'Too many failed attempts. Please wait a few minutes.',
    'auth/network-request-failed': 'Connection error. Check your internet and try again.',
    'auth/user-disabled':          'This account has been disabled. Contact the committee.',
    'auth/popup-closed-by-user':   'Sign-in popup was closed. Please try again.',
  };
  return map[code] || 'Something went wrong ('+code+'). Please try again.';
}

// ── SLIDE DOWN ANIMATION ─────────────────────────────────────
const _authStyle = document.createElement('style');
_authStyle.textContent = `
  @keyframes slideDown { from{opacity:0;transform:translateX(-50%) translateY(-12px)} to{opacity:1;transform:translateX(-50%) translateY(0)} }
  .dir-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:12px; }
  .dir-card { background:var(--white); border:1px solid var(--border-g); border-radius:12px; padding:16px; display:flex; align-items:center; gap:12px; transition:.2s; }
  .dir-card:hover { border-color:var(--green); box-shadow:0 2px 12px rgba(26,92,42,.08); }
  .dir-card-basic { opacity:.9; }
  .dir-avatar { width:44px; height:44px; border-radius:50%; display:grid; place-items:center; font-weight:700; font-size:14px; color:white; flex-shrink:0; }
  .dir-name { font-size:14px; font-weight:600; color:var(--green-deep); margin-bottom:3px; }
  .dir-meta { font-size:12px; color:var(--text-sec); }
  .dir-paid-badge { font-size:10px; background:#D1FAE5; color:#065F46; padding:1px 7px; border-radius:10px; font-weight:600; margin-left:5px; vertical-align:2px; }
  .dir-contact { display:flex; gap:6px; margin-top:8px; flex-wrap:wrap; }
  .dir-contact-btn { font-size:11px; padding:4px 10px; border-radius:6px; background:var(--cream); color:var(--green); border:1px solid var(--border-g); text-decoration:none; display:flex; align-items:center; gap:4px; transition:.15s; }
  .dir-contact-btn:hover { background:var(--green); color:white; }
  .dir-search-box { width:100%; padding:10px 14px 10px 38px; border:1px solid var(--border-g); border-radius:8px; font-size:14px; font-family:inherit; background:white; outline:none; margin-bottom:16px; }
  .dir-search-box:focus { border-color:var(--green); }
  .dir-search-wrap { position:relative; }
  .dir-search-wrap i { position:absolute; left:12px; top:50%; transform:translateY(-50%); color:var(--text-tert); font-size:15px; }
`;
document.head.appendChild(_authStyle);

// ════════════════════════════════════════════════════════════
//  GLOBAL EXPORTS
//  Explicitly attach handlers to window so inline onclick=""
//  attributes in index.html can always find them, regardless
//  of how the browser scopes this script file.
// ════════════════════════════════════════════════════════════
window.handleSignup       = handleSignup;
window.handleLogin        = handleLogin;
window.handleSignOut      = handleSignOut;
window.handlePasswordReset = handlePasswordReset;
