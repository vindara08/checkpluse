import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase, supabaseConfigured } from './supabase'
import './wardrobe.css'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8001/api'
const BUCKET = import.meta.env.VITE_SUPABASE_BUCKET || 'wardrobe-images'
const TERMS_VERSION = '1.1'
const PRIVACY_VERSION = '1.1'
const categories = ['All', 'Tops', 'Bottoms', 'Dresses', 'Outerwear', 'Shoes', 'Accessories']
const categoryOptions = categories.slice(1)
const AI_CATEGORY_MAP = {
  Top: 'Tops',
  Bottom: 'Bottoms',
  Dress: 'Dresses',
  Outerwear: 'Outerwear',
}
const seasonOptions = ['Spring', 'Summer', 'Monsoon', 'Autumn', 'Winter', 'All Season', 'All season']
const formalityOptions = ['Casual / Informal', 'Smart Casual', 'Formal']
const occasionOptions = ['Daily Wear', 'College', 'Office', 'Party', 'Travel', 'Sports', 'Wedding / Traditional', 'Other']
const requiredUserContext = [
  ['season', 'Season'],
  ['formality', 'Formality'],
  ['occasion', 'Occasion'],
]

function missingUserContext(item) {
  return requiredUserContext.find(([field]) => !item[field]?.trim())
}
const BUILT_IN_AVATARS = [
  { id: 'fern', label: 'Fern', src: '/avatars/fold-fern.svg' },
  { id: 'terracotta', label: 'Terracotta', src: '/avatars/fold-terracotta.svg' },
  { id: 'sage', label: 'Sage', src: '/avatars/fold-sage.svg' },
  { id: 'indigo', label: 'Indigo', src: '/avatars/fold-indigo.svg' },
  { id: 'ochre', label: 'Ochre', src: '/avatars/fold-ochre.svg' },
]
const DEFAULT_AVATAR_ID = 'fern'
const AVATAR_REQUEST_TIMEOUT_MS = 10000
const AUTH_CHECK_TIMEOUT_MS = 15000
const WARDROBE_LOAD_TIMEOUT_MS = 30000

function withTimeout(promise, timeoutMs, message) {
  let timeoutId
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs)
  })
  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timeoutId))
}

function createObjectId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0'))
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`
}

function Mark() {
  return <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
}

function AvatarImage({ value, initials, className = 'profile-avatar' }) {
  const [failedValue, setFailedValue] = useState(null)
  const avatar = BUILT_IN_AVATARS.find((choice) => choice.id === value) || BUILT_IN_AVATARS[0]
  const failed = failedValue === avatar.id
  return <span className={className} aria-label={`${avatar.label} avatar`}>
    {!failed ? <img src={avatar.src} alt="" onError={() => setFailedValue(avatar.id)} /> : initials}
  </span>
}

async function requestProfileAvatar(session, method, avatarId) {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), AVATAR_REQUEST_TIMEOUT_MS)
  const options = { method, signal: controller.signal, headers: { Authorization: `Bearer ${session.access_token}` } }
  if (avatarId) {
    options.headers['Content-Type'] = 'application/json'
    options.body = JSON.stringify({ avatar_id: avatarId })
  }
  try {
    const response = await fetch(`${API}/profile/avatar`, options)
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload.detail || 'Could not update your avatar.')
    return payload
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Avatar request timed out. Please try again.')
    if (error instanceof TypeError) throw new Error('Could not reach the avatar service. Check that the local API is running and try again.')
    throw error
  } finally {
    window.clearTimeout(timeoutId)
  }
}

function LoadingError({ message, onRetry }) {
  return <div className="notice load-error" role="alert"><span>{message}</span><button className="button button-outline" onClick={onRetry}>Retry</button></div>
}

function ThemeToggle({ theme, onChange }) {
  const nextTheme = theme === 'dark' ? 'light' : 'dark'
  return <button className="theme-toggle" type="button" onClick={() => onChange(nextTheme)} aria-label={`Switch to ${nextTheme} theme`}>
    <span aria-hidden="true">{theme === 'dark' ? '☼' : '◐'}</span>
    <span className="theme-toggle-label">{theme === 'dark' ? 'Light' : 'Dark'}</span>
  </button>
}

function Icon({ name }) {
  const paths = {
    home: <><path d="m3 10 9-7 9 7" /><path d="M5 9v11h14V9M9 20v-7h6v7" /></>,
    wardrobe: <><path d="M4 4h16v16H4z" /><path d="M8 4v16M16 4v16" /></>,
    add: <><path d="M12 5v14M5 12h14" /></>,
    outfits: <><path d="M4 5h16v15H4z" /><path d="m4 15 5-5 4 4 3-3 4 4M8 8h.01" /></>,
    profile: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20c.5-4 3-6 7-6s6.5 2 7 6" /></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
    menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
  }
  return <svg className="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.wardrobe}</svg>
}

function ProfileSectionNav({ active, onNavigate }) {
  return <nav className="profile-section-nav" aria-label="Profile sections">
    {[['profile', 'Profile'], ['security', 'Security'], ['account', 'Account'], ['privacy', 'Privacy']].map(([section, label]) =>
      <button key={section} className={active === section ? 'active' : ''} aria-current={active === section ? 'page' : undefined} onClick={() => onNavigate(section)}>{label}</button>
    )}
  </nav>
}

function LegalPage({ privacy = false, onBack, onPrivacy, activeSection, onSectionNavigate, backLabel = 'Back to account' }) {
  return <main className={`legal-page${activeSection ? ' profile-document' : ''}`}><button className="text-button back-link" onClick={onBack}>← {backLabel}</button><div className="eyebrow">THE FOLD / {privacy ? 'PRIVACY' : 'TERMS'}</div>{activeSection && <ProfileSectionNav active={activeSection} onNavigate={onSectionNavigate} />}<h1>{privacy ? 'Your wardrobe stays yours.' : 'Terms & conditions'}</h1><p className="legal-intro">{privacy ? 'A plain-language notice about personal data for The Fold.' : 'A straightforward agreement for keeping your personal wardrobe in one place.'}</p>
    {privacy ? <><section><h2>What we collect and why</h2><p>Your email, name and consent records support your account. Clothing photos and details are used to show your wardrobe and saved outfits. When you add an item, the photo is temporarily processed by the Main 9 clothing-analysis service to suggest clothing details; analysis does not create a wardrobe record or permanently store the photo. The photo is uploaded to your private wardrobe only after you review and save. Photos are not used to train models. The service has no advertising, analytics, precise location, or contacts collection.</p></section><section><h2>Where it is stored</h2><p>Account and wardrobe data are stored in Supabase Postgres. Compressed photos are stored in a private Supabase Storage bucket. Row-level security limits access to the signed-in account; FastAPI validates your Supabase session before temporarily processing an image for analysis or compression.</p></section><section><h2>Your choices and rights</h2><p>You can export your data, update your name and clothing details, or delete your account. Account deletion also requests removal of your stored photos. Contact: <strong>shubhank44jha@gmail.com</strong></p></section><section><h2>Security and retention</h2><p>Supabase Auth manages passwords and sessions. Images are re-encoded to strip embedded metadata. Unapproved analysis files are temporary and are removed after processing. Saved data is kept while your account is active and removed on account deletion, subject to technical backup retention and records required by law.</p></section><section><h2>India</h2><p>The implementation supports data minimisation, purpose limitation, safeguards, consent records, and user control. The operator must confirm current DPDP Act and Rules obligations, retention requirements, grievance contact, and any transfer practices with qualified counsel before launch.</p></section><p className="legal-footnote">Privacy notice version 1.1 · Effective 1 October 2026</p></> : <><section><h2>Using The Fold</h2><p>The Fold is a private tool for cataloguing clothing and saving outfits. You must be at least 18 years old to create an account. Keep your sign-in details confidential and tell us promptly if you suspect unauthorised access.</p></section><section><h2>Your content</h2><p>You retain ownership of photos and details you add. You allow us to store and display them only to provide the wardrobe and outfit features you request. Main 9 temporarily analyzes clothing photos to suggest details; you review and can correct its suggestions before saving. Photos are not used to train models or generate recommendations.</p></section><section><h2>Privacy and account closure</h2><p>We use account and wardrobe information only to provide the service and protect accounts. You can export your data or delete your account at any time. Deletion removes account records and associated photos. Read our <button className="inline-link" onClick={onPrivacy}>Privacy notice</button>.</p></section><section><h2>Availability and changes</h2><p>The service is provided as available and may change as this early version develops. We will give notice of material changes. You may stop using the service and delete your account at any time.</p></section><section><h2>Contact and complaints</h2><p>For support, privacy requests, or complaints, contact the operator using the address in the Privacy notice or deployment configuration. The operator should acknowledge and address complaints promptly.</p></section><p className="legal-footnote">Effective 1 October 2026 · Terms version 1.1</p><p className="legal-disclaimer">This starter text is not legal advice. Have final terms reviewed for actual operations in India.</p></>}
  </main>
}

async function loadClothing(userId) {
  const { data, error } = await supabase.from('clothing_items').select('*').eq('user_id', userId).order('created_at', { ascending: false })
  if (error) throw error
  return Promise.all(data.map(async (item) => {
    const { data: signed, error: signedError } = await supabase.storage.from(BUCKET).createSignedUrl(item.image_path, 3600)
    if (signedError) throw signedError
    return { ...item, image_url: signed.signedUrl }
  }))
}

async function loadOutfits(userId) {
  const { data: outfits, error } = await supabase.from('outfits').select('*').eq('user_id', userId).order('created_at', { ascending: false })
  if (error) throw error
  const hydratedOutfits = await Promise.all(outfits.map(async (outfit) => {
    const { data: links, error: linksError } = await supabase
      .from('outfit_items')
      .select('position, clothing_items(*)')
      .eq('outfit_id', outfit.id)
      .order('position')
    if (linksError) throw linksError
    const items = await Promise.all(links.map(async ({ clothing_items: item }) => {
      if (!item) return null
      const { data: signed, error: signedError } = await supabase.storage.from(BUCKET).createSignedUrl(item.image_path, 3600)
      if (signedError) throw signedError
      return { ...item, image_url: signed.signedUrl }
    }))
    return { ...outfit, items: items.filter(Boolean) }
  }))
  const validOutfits = hydratedOutfits.filter((outfit) => outfit.items.length > 0)
  const emptyOutfitIds = hydratedOutfits.filter((outfit) => outfit.items.length === 0).map((outfit) => outfit.id)
  if (emptyOutfitIds.length) {
    const { error: cleanupError } = await supabase.from('outfits').delete().eq('user_id', userId).in('id', emptyOutfitIds)
    if (cleanupError) throw cleanupError
  }
  return validOutfits
}

async function compressPhoto(file, session) {
  const form = new FormData()
  form.append('photo', file)
  const response = await fetch(`${API}/images/compress`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}` },
    body: form,
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.detail || 'Could not process this image.')
  }
  return response.blob()
}

function publicRouteFromPath(pathname) {
  if (pathname === '/login') return 'login'
  if (pathname === '/signup') return 'signup'
  if (pathname === '/privacy') return 'privacy'
  return 'landing'
}

function PublicLanding({ theme, onThemeChange, onNavigate }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const closeMenu = () => setMenuOpen(false)
  const navigate = (path) => {
    closeMenu()
    onNavigate(path)
  }
  return <main className="public-landing">
    <header className="public-header">
      <a className="public-wordmark" href="/" onClick={(event) => { event.preventDefault(); navigate('/') }} aria-label="The Fold home"><Mark /><span>THE FOLD<small>YOUR WARDROBE, WELL KEPT</small></span></a>
      <nav className={`public-nav${menuOpen ? ' public-nav-open' : ''}`} aria-label="Public navigation">
        <a href="#how-it-works" onClick={closeMenu}>How it works</a>
        <a href="#thoughtful-by-design" onClick={closeMenu}>Thoughtful by design</a>
        <button className="text-button public-login" onClick={() => navigate('/login')}>Log in</button>
        <button className="button button-primary public-nav-cta" onClick={() => navigate('/signup')}>Get started <span aria-hidden="true">↗</span></button>
      </nav>
      <div className="public-header-actions">
        <ThemeToggle theme={theme} onChange={onThemeChange} />
        <button className="public-menu-toggle" aria-label={menuOpen ? 'Close menu' : 'Open menu'} aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}><span /><span /></button>
      </div>
    </header>
    <section className="public-hero">
      <div className="public-hero-copy">
        <span className="eyebrow"><span className="public-status-dot" /> A LITTLE MORE ROOM TO GET DRESSED</span>
        <h1>Know what you own.<br /><em>Love getting dressed.</em></h1>
        <p className="public-hero-intro">A quieter place for the clothes you already have. Keep your wardrobe together, make outfits from your own pieces, and start the day with a little more clarity.</p>
        <div className="public-hero-actions"><button className="button button-primary" onClick={() => navigate('/signup')}>Make it yours <span aria-hidden="true">↗</span></button><button className="public-text-cta" onClick={() => navigate('/login')}>Already have an account? <span>Log in</span></button></div>
        <div className="public-proof"><span className="lock-dot" /> Private by default <i /> No ads or recommendations</div>
      </div>
      <div className="public-hero-visual" role="img" aria-label="Illustrative preview of a neatly organized digital wardrobe">
        <div className="public-visual-top"><span>YOUR WARDROBE</span><span className="public-visual-count">A PLACE FOR YOUR PIECES</span></div>
        <div className="public-visual-title"><strong>In good company.</strong><span>A considered view of what you own.</span></div>
        <div className="public-garment-grid">
          <div className="public-garment-card public-garment-card-sage"><span className="public-garment-shape public-garment-shirt" /><small>THE EVERYDAY</small></div>
          <div className="public-garment-card public-garment-card-clay"><span className="public-garment-shape public-garment-trousers" /><small>READY TO GO</small></div>
          <div className="public-garment-card public-garment-card-blue"><span className="public-garment-shape public-garment-coat" /><small>THE EXTRA LAYER</small></div>
        </div>
        <div className="public-visual-footer"><span><i /> MADE FROM YOUR WARDROBE</span><span>AN ILLUSTRATIVE PREVIEW</span></div><div className="public-visual-stamp" aria-hidden="true">YOURS<br />BY DESIGN</div>
      </div>
      <a className="public-scroll-cue" href="#how-it-works"><span /> A MORE THOUGHTFUL ROUTINE</a>
    </section>
    <section id="how-it-works" className="public-how">
      <div className="public-section-heading"><span className="eyebrow">LESS FUSS, MORE YOU</span><h2>A wardrobe that works<br />with real life.</h2><p>Keep your pieces close, your choices clear, and your personal style entirely your own.</p></div>
      <div className="public-feature-grid">
        <article className="public-feature"><span className="public-feature-number">01</span><span className="public-feature-icon" aria-hidden="true">↗</span><h3>Bring it all together</h3><p>Add photos of your clothes and keep a searchable, personal record of the pieces you reach for.</p><a href="/signup" onClick={(event) => { event.preventDefault(); navigate('/signup') }}>Start your wardrobe <span aria-hidden="true">→</span></a></article>
        <article className="public-feature"><span className="public-feature-number">02</span><span className="public-feature-icon public-feature-icon-coral" aria-hidden="true">✳</span><h3>A helpful first pass</h3><p>AI can suggest clothing details from a photo. You review and edit every suggestion before anything is saved.</p><a href="#thoughtful-by-design">See how it works <span aria-hidden="true">→</span></a></article>
        <article className="public-feature"><span className="public-feature-number">03</span><span className="public-feature-icon public-feature-icon-yellow" aria-hidden="true">＋</span><h3>Make outfits your own</h3><p>Put together looks from individual pieces in your wardrobe and save the combinations you want to remember.</p><a href="/signup" onClick={(event) => { event.preventDefault(); navigate('/signup') }}>Find your flow <span aria-hidden="true">→</span></a></article>
      </div>
    </section>
    <section id="thoughtful-by-design" className="public-review">
      <div className="public-review-art" aria-hidden="true"><div className="public-review-paper"><span className="eyebrow">A HUMAN-IN-THE-LOOP WARDROBE</span><div className="public-review-line" /><div className="public-review-line public-review-line-short" /><div className="public-review-chip">AI SUGGESTION</div><div className="public-review-edit"><span>Color</span><strong>Your call <i>⌄</i></strong></div><div className="public-review-confirm"><span>✓</span> Reviewed by you</div></div><span className="public-review-spark">✳</span></div>
      <div className="public-review-copy"><span className="eyebrow">THOUGHTFUL BY DESIGN</span><h2>AI helps with the details.<br /><em>You make the call.</em></h2><p>When you add a piece, The Fold can suggest what it sees. You can review and correct each suggestion, add the details that matter to you, and save only when everything looks right.</p><ul><li><span>01</span> Your photo is analyzed for clothing details.</li><li><span>02</span> You review and edit every suggested field.</li><li><span>03</span> Nothing is added until you choose to save.</li></ul><button className="button button-outline" onClick={() => navigate('/signup')}>See it for yourself <span aria-hidden="true">↗</span></button></div>
    </section>
    <section className="public-final-cta"><span className="eyebrow">START WITH WHAT YOU HAVE</span><h2>Your wardrobe, a little<br /><em>more in order.</em></h2><p>Make a space for your pieces and the outfits you make with them.</p><button className="button button-primary" onClick={() => navigate('/signup')}>Get started <span aria-hidden="true">↗</span></button><span className="public-final-note">PRIVATE BY DEFAULT · MADE FOR YOUR EVERYDAY</span></section>
    <footer className="public-footer"><a className="public-wordmark" href="/" onClick={(event) => { event.preventDefault(); navigate('/') }}><Mark /><span>THE FOLD<small>YOUR WARDROBE, WELL KEPT</small></span></a><span className="public-footer-note">YOUR PHOTOS ARE PRIVATE · AI SUGGESTIONS REVIEWED BY YOU · NO ADS</span><div><button className="text-button" onClick={() => navigate('/privacy')}>Privacy</button><button className="text-button" onClick={() => navigate('/login')}>Log in</button><button className="text-button" onClick={() => navigate('/signup')}>Get started</button></div></footer>
  </main>
}

function Auth({ mode, onModeChange, onSignedIn }) {
  const [legal, setLegal] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [accepted, setAccepted] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setError('')
    setMessage('')
    setBusy(true)
    try {
      if (mode === 'signup') {
        const { data, error: signupError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: name.trim(),
              age_confirmed: true,
              terms_accepted: true,
              privacy_accepted: true,
              terms_version: TERMS_VERSION,
              privacy_version: PRIVACY_VERSION,
            },
          },
        })
        if (signupError) throw signupError
        if (data.session) await onSignedIn(data.session)
        else setMessage('Check your email to confirm your account, then sign in.')
      } else {
        const { data, error: signinError } = await supabase.auth.signInWithPassword({ email, password })
        if (signinError) throw signinError
        await onSignedIn(data.session)
      }
    } catch (err) {
      setError(err.message || 'Could not complete sign in.')
    } finally {
      setBusy(false)
    }
  }

  if (legal) return <LegalPage privacy={legal === 'privacy'} onBack={() => setLegal('')} onPrivacy={() => setLegal('privacy')} />
  return <main className="auth-layout"><section className="auth-art"><div className="auth-art-top"><Mark /><span>PERSONAL WARDROBE / V0</span></div><div className="fabric-scene" aria-hidden="true"><div className="garment garment-one" /><div className="garment garment-two" /><div className="garment garment-three" /><div className="hanger" /><span className="scene-tag">01 — YOURS, BY DESIGN</span></div><div className="art-caption"><span>LESS SEARCHING.</span><span>MORE GETTING DRESSED.</span></div><div className="auth-art-footer"><span>PRIVATE BY DEFAULT</span><span>MADE FOR YOUR EVERYDAY</span></div></section><section className="auth-panel"><div className="auth-mobile-brand"><Mark /><span>THE FOLD</span></div><div className="auth-form-wrap"><div className="eyebrow">YOUR CLOSET, IN GOOD ORDER</div><h1>{mode === 'login' ? <>Come on<br />in.</> : <>Make room<br />for more.</>}</h1><p className="auth-copy">{mode === 'login' ? 'A little more clarity, every morning.' : 'Start with the pieces you reach for.'}</p><form className="auth-form" onSubmit={submit}>{mode === 'signup' && <label>Your name<input type="text" autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} /></label>}<label>Email address<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254} /></label><label>Password<input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(event) => setPassword(event.target.value)} required minLength={mode === 'signup' ? 12 : 1} maxLength={128} /><small>{mode === 'signup' ? 'Use at least 12 characters.' : 'Your password is managed securely by Supabase Auth.'}</small></label>{mode === 'signup' && <label className="consent-row"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} required /><span>I am 18 or older, agree to the <button type="button" className="inline-link" onClick={() => setLegal('terms')}>Terms &amp; Conditions</button>, and have read the <button type="button" className="inline-link" onClick={() => setLegal('privacy')}>Privacy notice</button>.</span></label>}{error && <p className="form-error" role="alert">{error}</p>}{message && <p className="profile-saved" role="status">{message}</p>}<button className="button button-primary auth-submit" disabled={busy || (mode === 'signup' && (!accepted || !name.trim()))}>{busy ? 'One moment…' : mode === 'login' ? 'Sign in' : 'Create account'}<span aria-hidden="true">↗</span></button></form><div className="auth-switch">{mode === 'login' ? 'New around here?' : 'Already have an account?'} <button className="inline-link" onClick={() => onModeChange(mode === 'login' ? 'signup' : 'login')}>{mode === 'login' ? 'Create an account' : 'Sign in'}</button></div><p className="auth-privacy-note"><span className="lock-dot" /> AI clothing suggestions are reviewed by you; photos are not used to train models. No ads or recommendations.</p></div><footer className="auth-bottom"><button className="text-button" onClick={() => setLegal('privacy')}>Privacy</button><span>© THE FOLD 2026</span><button className="text-button" onClick={() => setLegal('terms')}>Terms</button></footer></section></main>
}

function ProfilePage({ profile, email, session, theme, onThemeChange, section = 'profile', onNavigate, onBack, onSaved, onAvatarSaved, onPrivacy, onExport, onLogout, onDelete }) {
  const [name, setName] = useState(profile?.full_name || '')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [avatarOpen, setAvatarOpen] = useState(false)
  const [selectedAvatar, setSelectedAvatar] = useState(null)
  const [avatarError, setAvatarError] = useState('')
  const [avatarSaved, setAvatarSaved] = useState(false)
  const [avatarBusy, setAvatarBusy] = useState(false)
  async function submit(event) {
    event.preventDefault()
    setError('')
    setSaved(false)
    setBusy(true)
    try {
      const { data, error: updateError } = await supabase.from('profiles').update({ full_name: name.trim() }).eq('id', profile.id).select().single()
      if (updateError) throw updateError
      onSaved({ ...profile, ...data })
      setSaved(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  async function saveAvatar() {
    const avatarId = selectedAvatar || profile?.avatar_id || DEFAULT_AVATAR_ID
    if (avatarId === (profile?.avatar_id || DEFAULT_AVATAR_ID)) return
    setAvatarError('')
    setAvatarSaved(false)
    setAvatarBusy(true)
    try {
      const data = await requestProfileAvatar(session, 'PUT', avatarId)
      onAvatarSaved({ ...profile, avatar_id: data.avatar_id })
      setSelectedAvatar(null)
      setAvatarSaved(true)
      setAvatarOpen(false)
    } catch (err) {
      setAvatarError(err.message || 'Could not save your avatar.')
    } finally {
      setAvatarBusy(false)
    }
  }
  function cancelAvatarEdit() {
    setAvatarOpen(false)
    setSelectedAvatar(null)
    setAvatarError('')
  }
  return <main className="profile-page">
    <button className="text-button back-link" onClick={onBack}>← Back to wardrobe</button>
    <div className="eyebrow">YOUR ACCOUNT</div>
    <h1>{section === 'profile' ? 'Your profile' : section === 'security' ? 'Security' : 'Account'}</h1>
    <p className="legal-intro">{section === 'profile' ? 'A few details, kept just for you.' : section === 'security' ? 'How sign-in and account access are handled.' : 'Your account details and data controls.'}</p>
    <ProfileSectionNav active={section} onNavigate={onNavigate} />
    {section === 'profile' && <>
      <section className="profile-summary">
        <div className="profile-avatar-control">
          <AvatarImage value={profile?.avatar_id} initials={(name || email || '?').slice(0, 1).toUpperCase()} />
          <button className="avatar-edit-button" type="button" onClick={() => { setAvatarOpen((open) => !open); setSelectedAvatar(null); setAvatarError(''); setAvatarSaved(false) }} aria-expanded={avatarOpen} aria-label="Change avatar">✎</button>
        </div>
        <div><strong>{name || 'Your name'}</strong><span>{email}</span></div>
      </section>
      {avatarOpen && <section className="avatar-picker" aria-label="Choose avatar">
        <div className="profile-section-title"><strong>Choose your avatar</strong><span>Select an illustration for your profile.</span></div>
        <div className="avatar-choice-grid" role="radiogroup" aria-label="Built-in avatars">
          {BUILT_IN_AVATARS.map((avatar) => <button key={avatar.id} className={`avatar-choice${(selectedAvatar || profile?.avatar_id || DEFAULT_AVATAR_ID) === avatar.id ? ' selected' : ''}`} type="button" role="radio" aria-checked={(selectedAvatar || profile?.avatar_id || DEFAULT_AVATAR_ID) === avatar.id} onClick={() => { setSelectedAvatar(avatar.id); setAvatarError(''); setAvatarSaved(false) }}>
            <img src={avatar.src} alt="" /><span>{avatar.label}</span>
          </button>)}
        </div>
        {avatarError && <p className="form-error" role="alert">{avatarError}</p>}
        <div className="avatar-picker-actions">
          <button className="button button-quiet" type="button" disabled={avatarBusy} onClick={cancelAvatarEdit}>Cancel</button>
          <button className="button button-primary" type="button" disabled={avatarBusy || (selectedAvatar || profile?.avatar_id || DEFAULT_AVATAR_ID) === (profile?.avatar_id || DEFAULT_AVATAR_ID)} onClick={saveAvatar}>{avatarBusy ? 'Saving…' : 'Save avatar'}</button>
        </div>
      </section>}
      {avatarSaved && <p className="profile-saved" role="status">Avatar saved.</p>}
      <form className="profile-form" onSubmit={submit}>
        <div className="profile-section-title"><strong>Personal details</strong><span>Update the name shown with your wardrobe.</span></div>
        <label>Full name<input value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} autoComplete="name" /></label>
        <label>Email address<input value={email} readOnly /><small>Email is managed securely by your sign-in provider.</small></label>
        <div className="profile-preference"><span><strong>Appearance</strong><small>Choose light or dark mode.</small></span><ThemeToggle theme={theme} onChange={onThemeChange} /></div>
        {error && <p className="form-error" role="alert">{error}</p>}
        {saved && <p className="profile-saved" role="status">Profile saved.</p>}
        <button className="button button-primary" disabled={busy || !name.trim()}>{busy ? 'Saving…' : 'Save changes'}</button>
      </form>
    </>}
    {section === 'security' && <section className="profile-tool-card">
      <div className="profile-section-title"><strong>Sign-in security</strong><span>Your password and sign-in session are managed by Supabase Auth.</span></div>
      <p>The Fold does not store or display your password. Use your sign-in provider’s account recovery flow if you need to reset it.</p>
      <button className="button button-outline" type="button" onClick={onLogout}>Sign out of this session</button>
    </section>}
    {section === 'account' && <>
      <section className="profile-summary"><AvatarImage value={profile?.avatar_id} initials={(name || email || '?').slice(0, 1).toUpperCase()} /><div><strong>{name || 'Your name'}</strong><span>{email}</span></div></section>
      <section className="profile-options profile-account-actions">
        <div className="profile-section-title"><strong>Data and account actions</strong><span>Download a copy of your data or close your account.</span></div>
        <button className="profile-action" type="button" onClick={onExport}><span><strong>Download your data</strong><small>Save a copy of your wardrobe and account details.</small></span><Icon name="arrow" /></button>
        <button className="profile-action" type="button" onClick={onPrivacy}><span><strong>Privacy notice</strong><small>Review how your information is used and stored.</small></span><Icon name="arrow" /></button>
        <button className="profile-action" type="button" onClick={onLogout}><span><strong>Sign out</strong><small>End this session on this device.</small></span><Icon name="arrow" /></button>
        <button className="profile-action profile-danger" type="button" onClick={onDelete}><span><strong>Delete account</strong><small>Permanently remove your account and associated data.</small></span><Icon name="arrow" /></button>
      </section>
    </>}
  </main>
}

function ClothingCard({ item, onDelete, onDragStart, onOpen }) {
  const itemType = item.clothing_type?.replace(/_/g, ' ') || item.category
  return <article className="clothing-card" draggable onDragStart={(event) => onDragStart?.(event, item)}>
    <div className="clothing-image">
      <button className="clothing-image-button" onClick={() => onOpen(item)} aria-label={`View ${itemType}`}>
        <img src={item.image_url} alt={`${item.category}${item.dominant_color ? `, ${item.dominant_color}` : ''}`} loading="lazy" />
      </button>
      <button className="icon-button delete-piece" title="Remove clothing" aria-label="Remove clothing" onClick={() => onDelete(item)}>×</button>
    </div>
    <div className="clothing-details"><div><strong>{itemType}</strong><span>{item.category}{item.dominant_color ? ` · ${item.dominant_color}` : ''}</span></div></div>
  </article>
}

function CategoryFilters({ active, onSelect, count }) {
  return <div className="filter-row" role="group" aria-label="Filter by category">
    {categories.map((category) => <button key={category} className={`filter-chip${active === category ? ' selected' : ''}`} aria-pressed={active === category} onClick={() => onSelect(category)}>
      {category}{category === 'All' && <span>{count}</span>}
    </button>)}
  </div>
}

function EmptyState({ title, description, action, onAction }) {
  return <section className="empty-state">
    <div className="empty-art" aria-hidden="true"><div className="empty-hanger" /><div className="empty-shirt" /><div className="empty-trouser" /></div>
    <h2>{title}</h2><p>{description}</p>
    {action && <button className="button button-primary" onClick={onAction}>{action}<Icon name="arrow" /></button>}
  </section>
}

function ClothingEditor({ item, onClose, onSaved }) {
  const [category, setCategory] = useState(item.category)
  const [clothingType, setClothingType] = useState(item.clothing_type || '')
  const [dominantColor, setDominantColor] = useState(item.dominant_color || '')
  const [secondaryColor, setSecondaryColor] = useState(item.secondary_color || '')
  const [colorFamily, setColorFamily] = useState(item.color_family || '')
  const [brightness, setBrightness] = useState(item.brightness || '')
  const [pattern, setPattern] = useState(item.pattern || '')
  const [season, setSeason] = useState(item.season || '')
  const [formality, setFormality] = useState(item.formality || '')
  const [occasion, setOccasion] = useState(item.occasion || '')
  const [notes, setNotes] = useState(item.notes || '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function save(event) {
    event.preventDefault()
    const missing = missingUserContext({ season, formality, occasion })
    if (missing) {
      setError(`Select ${missing[1]} before saving this item.`)
      return
    }
    setBusy(true)
    setError('')
    const changes = {
      category,
      clothing_type: clothingType.trim(),
      dominant_color: dominantColor.trim(),
      secondary_color: secondaryColor.trim() || null,
      color_family: colorFamily.trim() || null,
      brightness: brightness.trim() || null,
      pattern: pattern.trim() || null,
      season,
      formality,
      occasion,
      notes: notes.trim(),
    }
    try {
      const { data, error: updateError } = await supabase.from('clothing_items').update(changes).eq('id', item.id).eq('user_id', item.user_id).select().single()
      if (updateError) throw updateError
      await onSaved({ ...item, ...data })
    } catch (err) {
      setError(err.message || 'Could not update this clothing item.')
    } finally {
      setBusy(false)
    }
  }
  return <div className="modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="edit-clothing-title">
      <div className="modal-heading"><div><span className="eyebrow">EDIT YOUR PIECE</span><h2 id="edit-clothing-title">Update details</h2></div><button className="icon-button close-button" aria-label="Close" onClick={onClose}>×</button></div>
      <form className="form-grid" noValidate onSubmit={save}>
        <label>Category<select value={category} onChange={(event) => setCategory(event.target.value)}>{categoryOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
        <label>Clothing type<input value={clothingType} onChange={(event) => setClothingType(event.target.value)} maxLength={60} /></label>
        <label>Dominant color<input value={dominantColor} onChange={(event) => setDominantColor(event.target.value)} maxLength={40} /></label>
        <label>Secondary color<input value={secondaryColor} onChange={(event) => setSecondaryColor(event.target.value)} maxLength={40} /></label>
        <label>Color family<input value={colorFamily} onChange={(event) => setColorFamily(event.target.value)} maxLength={40} /></label>
        <label>Brightness<input value={brightness} onChange={(event) => setBrightness(event.target.value)} maxLength={30} /></label>
        <label>Pattern<input value={pattern} onChange={(event) => setPattern(event.target.value)} maxLength={40} /></label>
        <label>Season *<select name="season" required value={season} onChange={(event) => setSeason(event.target.value)}><option value="">Choose season</option>{seasonOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
        <label>Formality *<select name="formality" required value={formality} onChange={(event) => setFormality(event.target.value)}><option value="">Choose formality</option>{formalityOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
        <label>Occasion *<select name="occasion" required value={occasion} onChange={(event) => setOccasion(event.target.value)}><option value="">Choose occasion</option>{occasionOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
        <label className="wide-field">Notes<textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={500} rows={4} /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="modal-actions wide-field"><button type="button" className="button button-quiet" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button></div>
      </form>
    </section>
  </div>
}

function ClothingDetails({ item, onClose, onDelete, onEdit }) {
  const itemType = item.clothing_type?.replace(/_/g, ' ') || item.category
  return <div className="modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="modal-panel detail-panel" role="dialog" aria-modal="true" aria-labelledby="detail-title">
      <button className="icon-button close-button detail-close" aria-label="Close item details" onClick={onClose}>×</button>
      <img className="detail-photo" src={item.image_url} alt={`${itemType}${item.dominant_color ? `, ${item.dominant_color}` : ''}`} />
      <div className="detail-copy"><span className="eyebrow">{item.category}</span><h2 id="detail-title">{itemType}</h2>
        <dl>
          {item.dominant_color && <div><dt>Dominant color</dt><dd>{item.dominant_color}</dd></div>}
          {item.secondary_color && <div><dt>Secondary color</dt><dd>{item.secondary_color}</dd></div>}
          {item.color_family && <div><dt>Color family</dt><dd>{item.color_family}</dd></div>}
          {item.brightness && <div><dt>Brightness</dt><dd>{item.brightness}</dd></div>}
          {item.pattern && <div><dt>Pattern</dt><dd>{item.pattern}</dd></div>}
          {item.season && <div><dt>Season</dt><dd>{item.season}</dd></div>}
          {item.formality && <div><dt>Formality</dt><dd>{item.formality}</dd></div>}
          {item.occasion && <div><dt>Occasion</dt><dd>{item.occasion}</dd></div>}
          {item.notes && <div><dt>Notes</dt><dd>{item.notes}</dd></div>}
        </dl>
        <div className="modal-actions"><button className="button button-quiet" onClick={onClose}>Close</button><button className="button button-outline" onClick={() => onEdit(item)}>Edit</button><button className="button button-danger" onClick={() => { onClose(); onDelete(item) }}>Remove item</button></div>
      </div>
    </section>
  </div>
}

function OutfitDetails({ outfit, onClose, onEdit }) {
  return <div className="modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="modal-panel outfit-detail-panel" role="dialog" aria-modal="true" aria-labelledby="outfit-detail-title">
      <div className="modal-heading"><div><span className="eyebrow">YOUR COMBINATION</span><h2 id="outfit-detail-title">{outfit.name}</h2></div><button className="icon-button close-button" aria-label="Close outfit details" onClick={onClose}>×</button></div>
      <div className="outfit-detail-grid">{outfit.items.map((item) => <figure key={item.id}><img src={item.image_url} alt={item.clothing_type || item.category} /><figcaption>{item.clothing_type?.replace(/_/g, ' ') || item.category}</figcaption></figure>)}</div>
      <div className="modal-actions"><button className="button button-quiet" onClick={onClose}>Close</button><button className="button button-primary" onClick={() => onEdit(outfit)}>Edit</button></div>
    </section>
  </div>
}

function BottomNav({ view, page, onNavigate, onAdd }) {
  const navItems = [
    ['home', 'Home', () => { onNavigate('home') }],
    ['wardrobe', 'Wardrobe', () => { onNavigate('wardrobe') }],
    ['add', 'Add', onAdd],
    ['outfits', 'Outfits', () => { onNavigate('outfits') }],
    ['profile', 'Profile', () => { onNavigate('profile') }],
  ]
  return <nav className="bottom-nav" aria-label="Main navigation">
    {navItems.map(([icon, label, action]) => {
      const active = icon === 'profile' ? ['profile', 'security', 'account', 'privacy'].includes(page) : view === icon
      return <button key={label} className={`${icon === 'add' ? 'bottom-add' : ''}${active ? ' active' : ''}`} aria-current={active ? 'page' : undefined} onClick={action}>
        <Icon name={icon} /><span>{label}</span>
      </button>
    })}
  </nav>
}

function SecondaryMenu({ open, onToggle, onNavigate, onExport, onLogout }) {
  return <div className="secondary-menu">
    <button className="secondary-menu-toggle" type="button" aria-label="Open account menu" aria-expanded={open} onClick={onToggle}><Icon name="menu" /></button>
    {open && <nav className="secondary-menu-panel" aria-label="Account and settings">
      <button type="button" onClick={() => onNavigate('account')}>Account</button>
      <button type="button" onClick={() => onNavigate('security')}>Security</button>
      <button type="button" onClick={() => onNavigate('privacy')}>Privacy</button>
      <button type="button" onClick={onExport}>Download your data</button>
      <button className="secondary-menu-danger" type="button" onClick={onLogout}>Sign out</button>
    </nav>}
  </div>
}

function AddClothing({ session, userId, onClose, onSaved }) {
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState('')
  const [items, setItems] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState(0)
  useEffect(() => {
    const body = document.body
    const previous = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflow: body.style.overflow,
    }
    const scrollY = window.scrollY
    body.style.position = 'fixed'
    body.style.top = `-${scrollY}px`
    body.style.left = '0'
    body.style.right = '0'
    body.style.width = '100%'
    body.style.overflow = 'hidden'
    return () => {
      Object.assign(body.style, previous)
      window.scrollTo(0, scrollY)
    }
  }, [])
  function chooseFile(next) {
    if (!next) return
    if (preview) URL.revokeObjectURL(preview)
    setFile(next)
    setPreview(URL.createObjectURL(next))
    setItems([])
    setError('')
  }
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  async function analyzeSelectedImage(nextFile) {
    if (!nextFile) throw new Error('Choose a photo to continue.')
    const form = new FormData()
    form.append('photo', nextFile)
    const response = await fetch(`${API}/images/analyze`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session?.access_token || ''}` },
      body: form,
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(payload.detail || payload.message || 'Could not analyze this image.')
    }
    if (!payload.success || !Array.isArray(payload.items) || !payload.items.length) {
      throw new Error(payload.message || 'No supported clothing was detected in that image.')
    }
    const analyzedItems = payload.items.map((candidate) => ({
      detection_index: candidate.detection_index ?? null,
      category: AI_CATEGORY_MAP[candidate.category] || categoryOptions[0],
      clothing_type: String(candidate.clothing_type || ''),
      dominant_color: String(candidate.dominant_color || ''),
      secondary_color: String(candidate.secondary_color || ''),
      color_family: String(candidate.color_family || ''),
      brightness: String(candidate.brightness || ''),
      pattern: String(candidate.pattern || ''),
      season: '',
      formality: '',
      occasion: '',
      notes: '',
    }))
    console.debug(`[Main 9] Frontend received ${analyzedItems.length} analyzed items.`)
    return analyzedItems
  }

  function updateItem(index, field, value) {
    setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item))
  }

  function validateUserContext() {
    const missingIndex = items.findIndex((item) => missingUserContext(item))
    if (missingIndex < 0) return true
    const missing = missingUserContext(items[missingIndex])
    setError(`Select ${missing[1]} for Item ${missingIndex + 1} before continuing.`)
    setStep(1)
    window.requestAnimationFrame(() => {
      document.querySelector(`.detected-item[data-item-index="${missingIndex}"] [name="${missing[0]}"]`)?.focus()
    })
    return false
  }

  async function submit(event) {
    event.preventDefault()
    if (step === 0) {
      if (!file) { setError('Choose a photo to continue.'); return }
      setBusy(true)
      setError('')
      try {
        const analyzedItems = await analyzeSelectedImage(file)
        setItems(analyzedItems)
        console.debug(`[Main 9] Frontend rendering ${analyzedItems.length} editable items.`)
        setStep(1)
      } catch (err) {
        setError(err.message || 'Could not analyze this photo.')
      } finally {
        setBusy(false)
      }
      return
    }
    if (step === 1) {
      if (!items.length) { setError('Keep at least one detected clothing item to continue.'); return }
      if (!validateUserContext()) return
      setError('')
      setStep(2)
      return
    }
    if (!file || !items.length) { setStep(0); setError('Choose a photo and review at least one clothing item.'); return }
    if (!validateUserContext()) return
    setBusy(true)
    setError('')
    const imagePaths = items.map(() => `${userId}/${createObjectId()}.webp`)
    try {
      const compressed = await compressPhoto(file, session)
      const uploads = await Promise.allSettled(items.map(async (item, index) => {
        const { error: uploadError } = await supabase.storage.from(BUCKET).upload(imagePaths[index], compressed, { contentType: 'image/webp', cacheControl: '3600', upsert: false })
        if (uploadError) throw uploadError
      }))
      const failedUpload = uploads.find((result) => result.status === 'rejected')
      if (failedUpload) {
        const { error: cleanupError } = await supabase.storage.from(BUCKET).remove(imagePaths)
        const uploadError = failedUpload.reason instanceof Error
          ? failedUpload.reason
          : new Error(String(failedUpload.reason))
        if (cleanupError) throw new Error(`No wardrobe items were saved, but some uploaded photos could not be cleaned up: ${cleanupError.message}`)
        if (uploadError.message?.toLowerCase().includes('mime type image/webp is not supported')) {
          throw new Error(`The ${BUCKET} bucket must allow image/webp uploads. In Supabase Storage, edit the bucket's allowed MIME types to include image/webp, then retry.`)
        }
        throw uploadError
      }

      const records = items.map((item, index) => ({
        user_id: userId,
        image_path: imagePaths[index],
        category: item.category,
        clothing_type: item.clothing_type.trim(),
        dominant_color: item.dominant_color.trim(),
        secondary_color: item.secondary_color.trim() || null,
        color_family: item.color_family.trim() || null,
        brightness: item.brightness.trim() || null,
        pattern: item.pattern.trim() || null,
        season: item.season,
        formality: item.formality,
        occasion: item.occasion,
        notes: item.notes.trim(),
      }))
      console.debug(`[Main 9] Saving ${records.length} user-reviewed clothing items.`)
      const { error: insertError } = await supabase.from('clothing_items').insert(records)
      if (insertError) {
        const { error: cleanupError } = await supabase.storage.from(BUCKET).remove(imagePaths)
        if (cleanupError) throw new Error(`No wardrobe items were saved, but the uploaded photos could not be cleaned up: ${cleanupError.message}`)
        throw insertError
      }
      await onSaved()
    } catch (err) {
      setError(err.message || 'Could not save this clothing item.')
    } finally {
      setBusy(false)
    }
  }
  const stepTitles = ['Start with a photo', 'Review detected items', 'Confirm your pieces']
  return <div className="modal-scrim add-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="modal-panel add-panel" data-step={step} role="dialog" aria-modal="true" aria-labelledby="add-title">
    <div className="modal-heading"><div><div className="eyebrow">ADD TO YOUR WARDROBE · {String(step + 1).padStart(2, '0')} / 03</div><h2 id="add-title">{stepTitles[step]}</h2></div><button className="icon-button close-button" aria-label="Close" onClick={onClose}>×</button></div>
    <div className="step-track" aria-label={`Step ${step + 1} of 3`}><span className={step >= 0 ? 'complete' : ''} /><span className={step >= 1 ? 'complete' : ''} /><span className={step >= 2 ? 'complete' : ''} /></div>
    <form noValidate onSubmit={submit} onFocus={(event) => { if (step === 1) event.target.scrollIntoView({ block: 'nearest', inline: 'nearest' }) }}>
      {step === 0 && <div className="add-step">
        <label className={`upload-zone${preview ? ' has-preview' : ''}`}>{preview ? <><img src={preview} alt="Selected clothing preview" /><span className="upload-change">Choose a different photo</span></> : <><span className="upload-icon">＋</span><strong>Choose a photo or take one</strong><span>JPG, PNG or WebP · up to 8 MB</span></>}<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(event) => chooseFile(event.target.files?.[0])} /></label>
        <p className="form-helper">A clear photo makes your digital closet easier to browse.</p>
      </div>}
      {step === 1 && <div className="add-step add-review-list">
        <p className="form-helper">Main 9 found {items.length} clothing {items.length === 1 ? 'item' : 'items'}. Review and correct each suggestion before saving.</p>
        {preview && <img className="form-preview" src={preview} alt="Photo analyzed by Main 9" />}
        {items.map((item, index) => <fieldset className="detected-item" data-item-index={index} key={`${item.detection_index ?? 'item'}-${index}`}>
          <legend>ITEM {index + 1} OF {items.length}</legend>
          <div className="form-grid">
            <label>Category<select value={item.category} onChange={(event) => updateItem(index, 'category', event.target.value)}>{categoryOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
            <label>Clothing type<input value={item.clothing_type} onChange={(event) => updateItem(index, 'clothing_type', event.target.value)} maxLength={60} required /></label>
            <label>Dominant color<input value={item.dominant_color} onChange={(event) => updateItem(index, 'dominant_color', event.target.value)} maxLength={40} /></label>
            <label>Secondary color<input value={item.secondary_color} onChange={(event) => updateItem(index, 'secondary_color', event.target.value)} maxLength={40} /></label>
            <label>Color family<input value={item.color_family} onChange={(event) => updateItem(index, 'color_family', event.target.value)} maxLength={40} /></label>
            <label>Brightness<input value={item.brightness} onChange={(event) => updateItem(index, 'brightness', event.target.value)} maxLength={30} /></label>
            <label>Pattern<input value={item.pattern} onChange={(event) => updateItem(index, 'pattern', event.target.value)} maxLength={40} /></label>
            <label>Season *<select name="season" required value={item.season} onChange={(event) => updateItem(index, 'season', event.target.value)}><option value="">Choose season</option>{seasonOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
            <label>Formality *<select name="formality" required value={item.formality} onChange={(event) => updateItem(index, 'formality', event.target.value)}><option value="">Choose formality</option>{formalityOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
            <label>Occasion *<select name="occasion" required value={item.occasion} onChange={(event) => updateItem(index, 'occasion', event.target.value)}><option value="">Choose occasion</option>{occasionOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
            <label className="wide-field">Notes<textarea value={item.notes} onChange={(event) => updateItem(index, 'notes', event.target.value)} maxLength={500} rows={3} placeholder="Anything you want to remember" /></label>
          </div>
        </fieldset>)}
      </div>}
      {step === 2 && <section className="add-review-list">
        {preview && <img className="form-preview" src={preview} alt="Photo to save with the reviewed items" />}
        <span className="eyebrow">READY TO SAVE {items.length} {items.length === 1 ? 'PIECE' : 'PIECES'}</span>
        {items.map((item, index) => <article className="reviewed-item" key={`${item.detection_index ?? 'item'}-${index}`}>
          <h3>{item.clothing_type.replace(/_/g, ' ')}</h3>
          <p>{[item.category, item.dominant_color, item.secondary_color, item.color_family, item.brightness, item.pattern, item.season, item.formality, item.occasion].filter(Boolean).join(' · ')}</p>
          {item.notes.trim() && <p>{item.notes}</p>}
        </article>)}
        <p className="form-helper">Nothing is uploaded to your wardrobe or added to the database until you save.</p>
      </section>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="modal-actions add-actions">
        <button type="button" className="button button-quiet" onClick={step ? () => setStep(step - 1) : onClose}>{step ? 'Back' : 'Cancel'}</button>
        <button className="button button-primary" disabled={busy || (step === 1 && !items.length)}>{busy ? step === 0 ? 'Analyzing clothing…' : 'Saving pieces…' : step === 2 ? 'Save all to wardrobe' : step === 0 ? 'Analyze photo' : 'Review and continue'}</button>
      </div>
    </form>
  </section></div>
}

function OutfitBuilder({ clothes, userId, outfit, onClose, onSaved }) {
  const [selected, setSelected] = useState(() => outfit ? outfit.items : [])
  const [name, setName] = useState(() => outfit?.name || 'Everyday outfit')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  function addItem(id) {
    const item = clothes.find((piece) => String(piece.id) === String(id))
    if (item) setSelected((current) => current.some((piece) => String(piece.id) === String(item.id)) ? current : [...current, item])
  }
  function drop(event) { event.preventDefault(); addItem(event.dataTransfer.getData('text/plain')) }
  async function save() {
    setBusy(true)
    setError('')
    try {
      if (!name.trim() || !selected.length) throw new Error('Add a name and at least one piece to save this outfit.')
      if (outfit) {
        const { error: outfitError } = await supabase.from('outfits').update({ name: name.trim() }).eq('id', outfit.id).eq('user_id', userId)
        if (outfitError) throw outfitError
        const { error: deleteLinksError } = await supabase.from('outfit_items').delete().eq('outfit_id', outfit.id)
        if (deleteLinksError) throw deleteLinksError
        const { error: itemsError } = await supabase.from('outfit_items').insert(selected.map((item, position) => ({ outfit_id: outfit.id, clothing_id: item.id, position })))
        if (itemsError) throw itemsError
      } else {
        const { data: createdOutfit, error: outfitError } = await supabase.from('outfits').insert({ user_id: userId, name: name.trim() }).select().single()
        if (outfitError) throw outfitError
        const { error: itemsError } = await supabase.from('outfit_items').insert(selected.map((item, position) => ({ outfit_id: createdOutfit.id, clothing_id: item.id, position })))
        if (itemsError) {
          await supabase.from('outfits').delete().eq('id', createdOutfit.id).eq('user_id', userId)
          throw itemsError
        }
      }
      await onSaved()
    } catch (err) { setError(err.message || 'Could not save the outfit.') } finally { setBusy(false) }
  }
  return <div className="modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="modal-panel outfit-panel" role="dialog" aria-modal="true" aria-labelledby="outfit-title"><div className="modal-heading"><div><div className="eyebrow">OUTFIT BUILDER</div><h2 id="outfit-title">Put a look together</h2></div><button className="icon-button close-button" aria-label="Close" onClick={onClose}>×</button></div><label className="outfit-name">Outfit name<input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} /></label><div className="builder-layout"><div className="builder-pieces"><div className="builder-label">YOUR PIECES <span>TAP OR DRAG TO CANVAS</span></div><div className="builder-piece-list">{clothes.map((item) => <button key={item.id} className="builder-piece" draggable onClick={() => addItem(item.id)} onDragStart={(event) => event.dataTransfer.setData('text/plain', String(item.id))}><img src={item.image_url} alt="" /><span>{item.category}<small>{item.dominant_color || item.clothing_type?.replace(/_/g, ' ') || 'Piece'}</small></span></button>)}</div></div><div className="outfit-canvas" onDragOver={(event) => event.preventDefault()} onDrop={drop}><span className="canvas-label">CANVAS <span>{selected.length} PIECES</span></span>{selected.length ? <div className="canvas-items">{selected.map((item) => <div className="canvas-piece" key={item.id}><img src={item.image_url} alt={item.category} /><button className="icon-button" title="Remove from outfit" aria-label="Remove from outfit" onClick={() => setSelected((current) => current.filter((piece) => piece.id !== item.id))}>×</button><small>{item.category}</small></div>)}</div> : <div className="canvas-empty"><span>＋</span><strong>Drop a piece here</strong><small>Start with something you love.</small></div>}</div></div>{error && <p className="form-error" role="alert">{error}</p>}  <div className="modal-actions"><button className="button button-quiet" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={!selected.length || !name.trim() || busy} onClick={save}>{busy ? 'Saving…' : 'Save outfit'}</button></div></section></div>
}

export default function WardrobeApp() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [clothes, setClothes] = useState([])
  const [outfits, setOutfits] = useState([])
  const [view, setView] = useState('home')
  const [page, setPage] = useState('app')
  const [filter, setFilter] = useState('All')
  const [search, setSearch] = useState('')
  const [selectedItem, setSelectedItem] = useState(null)
  const [editingItem, setEditingItem] = useState(null)
  const [selectedOutfit, setSelectedOutfit] = useState(null)
  const [publicRoute, setPublicRoute] = useState(() => publicRouteFromPath(window.location.pathname))
  const [theme, setTheme] = useState(() => window.localStorage.getItem('the-fold-theme') === 'dark' ? 'dark' : 'light')
  const [modal, setModal] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [busy, setBusy] = useState(supabaseConfigured)
  const [notice, setNotice] = useState('')
  const [loadingError, setLoadingError] = useState('')
  const activeUserId = useRef(null)
  const busyRef = useRef(busy)
  const busyStartedAtRef = useRef(null)
  const refreshAttemptRef = useRef(0)
  const refreshInFlightRef = useRef(null)
  const avatarRevisionRef = useRef(0)
  const lastWardrobeRefreshRef = useRef(0)
  const lastVisibilityCheckRef = useRef(0)
  const user = session?.user
  const userId = user?.id
  const accessToken = session?.access_token
  useEffect(() => {
    window.localStorage.setItem('the-fold-theme', theme)
  }, [theme])
  useEffect(() => {
    const handlePopState = () => setPublicRoute(publicRouteFromPath(window.location.pathname))
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])
  const navigatePublic = useCallback((path) => {
    window.history.pushState({}, '', path)
    setPublicRoute(publicRouteFromPath(path))
    window.scrollTo(0, 0)
  }, [])
  const updateBusy = useCallback((nextBusy) => {
    busyRef.current = nextBusy
    if (nextBusy) busyStartedAtRef.current = Date.now()
    setBusy(nextBusy)
  }, [])
  const applySession = useCallback((nextSession) => {
    const nextUserId = nextSession?.user.id ?? null
    if (activeUserId.current !== nextUserId) {
      activeUserId.current = nextUserId
      avatarRevisionRef.current += 1
      refreshAttemptRef.current += 1
      updateBusy(Boolean(nextUserId))
      setLoadingError('')
    }
    setSession(nextSession)
  }, [updateBusy])
  const signInFromPublicPage = useCallback(async (nextSession) => {
    applySession(nextSession)
    navigatePublic('/')
  }, [applySession, navigatePublic])

  const refresh = useCallback(async () => {
    if (!userId) return
    if (refreshInFlightRef.current?.userId === userId) return refreshInFlightRef.current.promise

    const attempt = ++refreshAttemptRef.current
    const request = (async () => {
      const [wardrobe, saved, profileResult] = await withTimeout(Promise.all([
        loadClothing(userId),
        loadOutfits(userId),
        supabase.from('profiles').select('*').eq('id', userId).single(),
      ]), WARDROBE_LOAD_TIMEOUT_MS, 'Loading your wardrobe took too long. Check your connection and retry.')
      if (profileResult.error) throw profileResult.error
      if (activeUserId.current !== userId || refreshAttemptRef.current !== attempt) return
      setClothes(wardrobe)
      setOutfits(saved)
      setProfile(profileResult.data)
      setLoadingError('')
      lastWardrobeRefreshRef.current = Date.now()
      const avatarRevision = avatarRevisionRef.current
      withTimeout(
        requestProfileAvatar({ access_token: accessToken }, 'GET'),
        8000,
        'Loading your avatar took too long.',
      ).then((avatar) => {
        if (activeUserId.current === userId && refreshAttemptRef.current === attempt && avatarRevisionRef.current === avatarRevision) {
          setProfile((current) => current?.id === userId ? { ...current, ...avatar, avatarLoadError: '' } : current)
        }
      }).catch((error) => {
        if (activeUserId.current === userId && refreshAttemptRef.current === attempt && avatarRevisionRef.current === avatarRevision) {
          setProfile((current) => current?.id === userId
            ? { ...current, avatarLoadError: error.message || 'Could not load your avatar.' }
            : current)
        }
      })
    })()
    const trackedRequest = request.finally(() => {
      if (refreshInFlightRef.current?.promise === trackedRequest) refreshInFlightRef.current = null
    })
    refreshInFlightRef.current = { userId, promise: trackedRequest, startedAt: Date.now() }
    return trackedRequest
  }, [accessToken, userId])

  useEffect(() => {
    if (!supabaseConfigured) return undefined
    let active = true
    if (busyRef.current && busyStartedAtRef.current === null) busyStartedAtRef.current = Date.now()
    withTimeout(supabase.auth.getSession(), AUTH_CHECK_TIMEOUT_MS, 'Checking your sign-in session took too long. Retry to continue.')
      .then(({ data, error }) => {
      if (error) throw error
      if (active) {
        setLoadingError('')
        applySession(data.session)
        if (!data.session) updateBusy(false)
      }
      }).catch((error) => {
      if (active) {
        setLoadingError(error.message || 'Could not check your sign-in session.')
        if (!activeUserId.current) updateBusy(false)
      }
      })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      applySession(nextSession)
      if (event === 'INITIAL_SESSION') setLoadingError('')
      if (event === 'INITIAL_SESSION' && !nextSession) updateBusy(false)
      if (!nextSession) {
        updateBusy(false)
        setLoadingError('')
        setProfile(null)
        setClothes([])
        setOutfits([])
      }
    })
    return () => { active = false; subscription.unsubscribe() }
  }, [applySession, updateBusy])

  useEffect(() => {
    if (!userId) return undefined
    let active = true
    refresh().catch((error) => {
      if (active) setLoadingError(error.message || 'Could not load your wardrobe.')
    }).finally(() => {
      if (active) updateBusy(false)
    })
    return () => { active = false }
  }, [userId, refresh, updateBusy])

  useEffect(() => {
    let active = true
    let checking = false
    async function recoverWhenVisible() {
      if (document.visibilityState !== 'visible' || checking) return
      const now = Date.now()
      if (now - lastVisibilityCheckRef.current < 15000) return
      const currentBusy = busyRef.current
      const staleAfter = activeUserId.current ? WARDROBE_LOAD_TIMEOUT_MS : AUTH_CHECK_TIMEOUT_MS
      const staleLoading = currentBusy && now - (busyStartedAtRef.current ?? now) >= staleAfter
      const staleData = activeUserId.current && now - lastWardrobeRefreshRef.current > 5 * 60 * 1000
      if (currentBusy && !staleLoading) return
      if (!currentBusy && !activeUserId.current) return
      if (!staleLoading && !staleData) return
      lastVisibilityCheckRef.current = now
      checking = true
      try {
        if (!activeUserId.current) {
          const { data, error } = await withTimeout(
            supabase.auth.getSession(),
            AUTH_CHECK_TIMEOUT_MS,
            'Could not restore your sign-in session after returning. Retry to continue.',
          )
          if (error) throw error
          if (!active) return
          if (data.session) {
            applySession(data.session)
          } else {
            setLoadingError('')
            updateBusy(false)
          }
          return
        }

        if (staleLoading) {
          refreshAttemptRef.current += 1
          refreshInFlightRef.current = null
        }
        setLoadingError('')
        updateBusy(true)
        try {
          await refresh()
        } catch (refreshError) {
          if (active) setLoadingError(refreshError.message || 'Could not refresh your wardrobe.')
        } finally {
          if (active) updateBusy(false)
        }
      } catch (error) {
        if (active) {
          setLoadingError(error.message || 'Could not recover your session after returning.')
          updateBusy(false)
        }
      } finally {
        checking = false
      }
    }
    document.addEventListener('visibilitychange', recoverWhenVisible)
    window.addEventListener('focus', recoverWhenVisible)
    return () => {
      active = false
      document.removeEventListener('visibilitychange', recoverWhenVisible)
      window.removeEventListener('focus', recoverWhenVisible)
    }
  }, [applySession, refresh, updateBusy])

  async function removeClothing(item) {
    try {
      const { data: outfitLinks, error: linksError } = await supabase
        .from('outfit_items')
        .select('outfit_id, outfits(name)')
        .eq('clothing_id', item.id)
      if (linksError) throw linksError
      const affectedOutfitIds = [...new Set(outfitLinks.map((link) => link.outfit_id))]
      const affectedNames = outfitLinks.map((link) => link.outfits?.name).filter(Boolean)
      const warning = affectedNames.length
        ? `This item is currently used in ${affectedNames.length === 1 ? `the outfit “${affectedNames[0]}”` : `${affectedNames.length} outfits (${affectedNames.join(', ')})`}. Deleting it will also remove ${affectedNames.length === 1 ? 'that outfit' : 'those outfits'}. Continue?`
        : 'Are you sure you want to delete this item?'
      if (!window.confirm(warning)) return
      if (affectedOutfitIds.length) {
        const { error: outfitsError } = await supabase
          .from('outfits')
          .delete()
          .eq('user_id', userId)
          .in('id', affectedOutfitIds)
        if (outfitsError) throw outfitsError
        }
        const { error: deleteError } = await supabase.from('clothing_items').delete().eq('id', item.id).eq('user_id', userId)
        if (deleteError) throw deleteError
        const { error: storageError } = await supabase.storage.from(BUCKET).remove([item.image_path])
        await refresh()
      if (storageError) throw new Error(`Clothing item removed, but its stored photo could not be deleted: ${storageError.message}`)
    } catch (error) { setNotice(error.message) }
  }

  async function exportData() {
    try {
      const [items, savedOutfits, links, consent] = await Promise.all([
        supabase.from('clothing_items').select('id,category,clothing_type,dominant_color,secondary_color,color_family,brightness,pattern,season,formality,occasion,notes,image_path,created_at,updated_at').eq('user_id', userId),
        supabase.from('outfits').select('id,name,created_at').eq('user_id', userId),
        supabase.from('outfit_items').select('outfit_id,clothing_id,position'),
        supabase.from('consent_records').select('consent_type,version,accepted_at').eq('user_id', userId),
      ])
      for (const result of [items, savedOutfits, links, consent]) if (result.error) throw result.error
      const exportProfile = { ...(profile || {}) }
      delete exportProfile.avatarLoadError
      const payload = { profile: exportProfile, consent: consent.data, clothing: items.data, outfits: savedOutfits.data.map((outfit) => ({ ...outfit, clothing_ids: links.data.filter((link) => link.outfit_id === outfit.id).sort((a, b) => a.position - b.position).map((link) => link.clothing_id) })), exported_at: new Date().toISOString() }
      const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url
      link.download = 'the-fold-data.json'
      link.style.display = 'none'
      document.body.append(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) { setNotice(error.message) }
  }

  async function deleteAccount() {
    if (!window.confirm('Delete your account, wardrobe details, outfits, and stored photos? This cannot be undone.')) return
    try {
      const objects = []
      for (let offset = 0; ; offset += 100) {
        const { data, error } = await supabase.storage.from(BUCKET).list(userId, { limit: 100, offset })
        if (error) throw error
        objects.push(...data.filter((object) => object.id).map((object) => `${userId}/${object.name}`))
        if (data.length < 100) break
      }
      for (let offset = 0; ; offset += 100) {
        const { data, error } = await supabase.storage.from(BUCKET).list(`${userId}/avatars`, { limit: 100, offset })
        if (error) throw error
        objects.push(...data.filter((object) => object.id).map((object) => `${userId}/avatars/${object.name}`))
        if (data.length < 100) break
      }
      for (let offset = 0; offset < objects.length; offset += 100) {
        const { error } = await supabase.storage.from(BUCKET).remove(objects.slice(offset, offset + 100))
        if (error) throw error
      }
      const { error } = await supabase.rpc('delete_my_account')
      if (error) throw error
      await supabase.auth.signOut({ scope: 'local' })
      navigatePublic('/')
    } catch (error) { setNotice(error.message) }
  }

  async function logout() {
    const { error } = await supabase.auth.signOut()
    if (error) setNotice(error.message)
    else navigatePublic('/')
  }

  async function retryLoading() {
    setLoadingError('')
    updateBusy(true)
    try {
      const { data, error } = await withTimeout(
        supabase.auth.getSession(),
        AUTH_CHECK_TIMEOUT_MS,
        'Checking your sign-in session took too long. Retry to continue.',
      )
      if (error) throw error
      const sameUser = (data.session?.user.id ?? null) === activeUserId.current
      applySession(data.session)
      if (!data.session) {
        updateBusy(false)
        return
      }
      if (sameUser) await refresh()
    } catch (error) {
      setLoadingError(error.message || 'Could not recover your session. Please retry.')
      updateBusy(false)
    }
  }

  async function retryWardrobe() {
    setLoadingError('')
    updateBusy(true)
    try {
      await refresh()
    } catch (error) {
      setLoadingError(error.message || 'Could not load your wardrobe.')
    } finally {
      updateBusy(false)
    }
  }

  if (!supabaseConfigured) return <main className="legal-page"><div className="eyebrow">THE FOLD / SETUP</div><h1>Supabase is not configured.</h1><p className="legal-intro">Create a local <code>.env.local</code> from the provided example and set the Supabase project URL and publishable key. Follow <code>SUPABASE_SETUP.md</code> to create the database tables, private image bucket and access policies.</p></main>
  if (busy) return <div className="loading-screen"><Mark /><span>Opening your wardrobe…</span></div>
  if (loadingError && !session) return <main className="loading-recovery"><Mark /><h1>We couldn’t open your wardrobe.</h1><p>{loadingError}</p><button className="button button-primary" onClick={retryLoading}>Retry</button></main>
  const profileSection = ['profile', 'security', 'account'].includes(page) ? page : ''
  const navigateProfileSection = (section) => setPage(section)
  const profileNav = (next) => next === 'profile' || next === 'security' || next === 'account' ? navigateProfileSection(next) : setPage(next)
  const saveAvatarToProfile = (nextProfile) => {
    avatarRevisionRef.current += 1
    setProfile(nextProfile)
  }
  const closeAccountMenu = () => setMenuOpen(false)
  const navigateAccountMenu = (section) => { closeAccountMenu(); setPage(section) }
  const exportFromMenu = () => { closeAccountMenu(); exportData() }
  const logoutFromMenu = () => { closeAccountMenu(); logout() }
  const mobileSectionHeader = <header className="mobile-section-header">
    <button className="wordmark" onClick={() => { setPage('app'); setView('home') }} aria-label="The Fold home"><Mark /><span>THE FOLD<small>YOUR WARDROBE, WELL KEPT</small></span></button>
    <SecondaryMenu open={menuOpen} onToggle={() => setMenuOpen((current) => !current)} onNavigate={navigateAccountMenu} onExport={exportFromMenu} onLogout={logoutFromMenu} />
  </header>
  if (profileSection && user && !profile) return <div className={`app-shell theme-${theme}`}>{mobileSectionHeader}{loadingError && <LoadingError message={loadingError} onRetry={retryWardrobe} />}<main className="profile-page"><button className="text-button back-link" onClick={() => setPage('app')}>← Back to wardrobe</button><div className="eyebrow">YOUR ACCOUNT</div><h1>Profile unavailable</h1><p className="legal-intro">Your profile could not be loaded. Return to the wardrobe and try again.</p>{notice && <p className="form-error" role="alert">{notice}</p>}</main><BottomNav view={view} page={page} onNavigate={(next) => next === 'profile' ? setPage('profile') : (setPage('app'), setView(next))} onAdd={() => { setPage('app'); setModal('add') }} /></div>
  if (profileSection && user) return <div className={`app-shell theme-${theme}`}>{mobileSectionHeader}{loadingError && <LoadingError message={loadingError} onRetry={retryWardrobe} />}<ProfilePage profile={profile} email={user.email} session={session} theme={theme} section={profileSection} onNavigate={profileNav} onThemeChange={setTheme} onBack={() => setPage('app')} onSaved={setProfile} onAvatarSaved={saveAvatarToProfile} onPrivacy={() => setPage('privacy')} onExport={exportData} onLogout={logout} onDelete={deleteAccount} /><BottomNav view={view} page={page} onNavigate={(next) => next === 'profile' ? setPage('profile') : (setPage('app'), setView(next))} onAdd={() => { setPage('app'); setModal('add') }} /></div>
  if (page === 'privacy' && user) return <div className={`app-shell theme-${theme}`}>{mobileSectionHeader}{loadingError && <LoadingError message={loadingError} onRetry={retryWardrobe} />}<LegalPage privacy activeSection="privacy" onSectionNavigate={profileNav} onBack={() => setPage('app')} /><BottomNav view={view} page={page} onNavigate={(next) => next === 'profile' ? setPage('profile') : (setPage('app'), setView(next))} onAdd={() => { setPage('app'); setModal('add') }} /></div>
  if (!session && publicRoute === 'privacy') return <LegalPage privacy backLabel="Back to The Fold" onBack={() => navigatePublic('/')} />
  if (!session) {
    if (publicRoute === 'login' || publicRoute === 'signup') {
      return <div className={`app-shell theme-${theme}`}><Auth mode={publicRoute} onModeChange={(mode) => navigatePublic(mode === 'signup' ? '/signup' : '/login')} onSignedIn={signInFromPublicPage} /></div>
    }
    return <div className={`app-shell theme-${theme}`}><PublicLanding theme={theme} onThemeChange={setTheme} onNavigate={navigatePublic} /></div>
  }

  if (view !== 'legacy') {
    const visible = clothes.filter((item) => (filter === 'All' || item.category === filter) &&
      `${item.category} ${item.clothing_type || ''} ${item.dominant_color || ''} ${item.secondary_color || ''} ${item.color_family || ''} ${item.brightness || ''} ${item.pattern || ''} ${item.season || ''} ${item.formality || ''} ${item.occasion || ''} ${item.notes || ''}`.toLowerCase().includes(search.trim().toLowerCase()))
    const navigate = (nextView) => {
      if (nextView === 'profile') setPage('profile')
      else { setPage('app'); setView(nextView) }
    }
    const displayName = profile?.full_name || user.email
    return <div className={`app-shell theme-${theme}`}>
      <header className="topbar">
        <button className="wordmark" onClick={() => navigate('home')} aria-label="The Fold home"><Mark /><span>THE FOLD<small>YOUR WARDROBE, WELL KEPT</small></span></button>
        <nav className="top-nav" aria-label="Main navigation">
          <button className={view === 'home' ? 'nav-active' : ''} onClick={() => navigate('home')}>Home</button>
          <button className={view === 'wardrobe' ? 'nav-active' : ''} onClick={() => navigate('wardrobe')}>Wardrobe <span>{clothes.length}</span></button>
          <button className={view === 'outfits' ? 'nav-active' : ''} onClick={() => navigate('outfits')}>Outfits <span>{outfits.length}</span></button>
        </nav>
        <div className="account-menu"><button className="account-trigger" onClick={() => navigate('profile')} aria-label="Open profile"><AvatarImage className="user-avatar" value={profile?.avatar_id} initials={displayName?.slice(0, 1).toUpperCase()} /><span className="user-email">{displayName}</span></button><ThemeToggle theme={theme} onChange={setTheme} /><SecondaryMenu open={menuOpen} onToggle={() => setMenuOpen((current) => !current)} onNavigate={navigateAccountMenu} onExport={exportFromMenu} onLogout={logoutFromMenu} /></div>
      </header>
      <main className="workspace">
        {loadingError && <LoadingError message={loadingError} onRetry={retryWardrobe} />}
        {notice && <div className="notice" role="status">{notice}<button className="text-button" onClick={() => setNotice('')}>Dismiss</button></div>}
        {view === 'home' && <section className="home-view">
          <div className="home-welcome"><div><span className="eyebrow">A LITTLE MORE ROOM TO GET DRESSED</span><h1>Good to see you{profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}.</h1><p>Your wardrobe, thoughtfully gathered in one place.</p></div><button className="button button-primary" onClick={() => setModal('add')}><Icon name="add" /> Add a piece</button></div>
          <div className="home-stat-grid"><button className="home-stat" onClick={() => navigate('wardrobe')}><span>IN YOUR WARDROBE</span><strong>{clothes.length}</strong><small>pieces to wear and love <Icon name="arrow" /></small></button><button className="home-stat" onClick={() => navigate('outfits')}><span>LOOKS SAVED</span><strong>{outfits.length}</strong><small>outfits of your own <Icon name="arrow" /></small></button></div>
          <section className="home-section"><div className="section-heading"><div><span className="eyebrow">RECENT ADDITIONS</span><h2>In your wardrobe</h2></div><button className="text-button" onClick={() => navigate('wardrobe')}>See all <Icon name="arrow" /></button></div>
            {clothes.length ? <div className="clothing-grid home-clothing-grid">{clothes.slice(0, 4).map((item) => <ClothingCard key={item.id} item={item} onDelete={removeClothing} onOpen={setSelectedItem} onDragStart={(event, piece) => event.dataTransfer.setData('text/plain', String(piece.id))} />)}</div> : <EmptyState title="Your wardrobe starts here." description="Add a photo and the details you care about. Your pieces stay private." action="Add your first piece" onAction={() => setModal('add')} />}
          </section>
        </section>}
        {view === 'wardrobe' && <section className="wardrobe-view">
          <div className="page-heading"><div><span className="eyebrow">A CLEARER VIEW OF WHAT YOU OWN</span><h1>Your wardrobe <span className="heading-count">{clothes.length}</span></h1><p>Every piece, in its place.</p></div><div className="heading-actions"><button className="button button-outline" onClick={() => setModal('outfit')} disabled={!clothes.length}>Build an outfit</button><button className="button button-primary" onClick={() => setModal('add')}><Icon name="add" /> Add a piece</button></div></div>
          <CategoryFilters active={filter} onSelect={setFilter} count={clothes.length} />
          <label className="search-box"><Icon name="search" /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search your pieces" aria-label="Search clothing" />{search && <button className="text-button" type="button" onClick={() => setSearch('')}>Clear</button>}</label>
          {visible.length ? <div className="clothing-grid">{visible.map((item) => <ClothingCard key={item.id} item={item} onDelete={removeClothing} onOpen={setSelectedItem} onDragStart={(event, piece) => event.dataTransfer.setData('text/plain', String(piece.id))} />)}</div> : <EmptyState title={search ? 'No pieces match that search.' : filter === 'All' ? 'Your wardrobe starts here.' : `No ${filter.toLowerCase()} yet.`} description={search ? 'Try another color, category, or detail.' : 'Add a photo and the details you care about. Your pieces stay private.'} action={!search ? 'Add your first piece' : undefined} onAction={() => setModal('add')} />}
        </section>}
        {view === 'outfits' && <section className="outfits-view"><div className="page-heading"><div><span className="eyebrow">MADE FROM WHAT YOU HAVE</span><h1>Saved outfits <span className="heading-count">{outfits.length}</span></h1><p>Looks worth coming back to.</p></div><button className="button button-primary" disabled={!clothes.length} onClick={() => setModal('outfit')}>Build an outfit</button></div>
          {outfits.length ? <div className="saved-outfit-grid">{outfits.map((outfit) => <button className="saved-outfit" key={outfit.id} onClick={() => setSelectedOutfit(outfit)}><div className="saved-outfit-images">{outfit.items.slice(0, 3).map((item) => <img key={item.id} src={item.image_url} alt="" />)}</div><div className="saved-outfit-caption"><strong>{outfit.name}</strong><span>{outfit.items.length} {outfit.items.length === 1 ? 'piece' : 'pieces'} <Icon name="arrow" /></span></div></button>)}</div> : <EmptyState title="No outfits saved yet." description="Combine pieces from your wardrobe and save a look to return to." action={clothes.length ? 'Build an outfit' : 'Add a piece first'} onAction={() => clothes.length ? setModal('outfit') : setModal('add')} />}
        </section>}
      </main>
      <footer className="workspace-footer"><span>YOUR PHOTOS ARE PRIVATE · AI SUGGESTIONS REVIEWED BY YOU · NO ADS</span><button className="text-button" onClick={() => setPage('privacy')}>Privacy &amp; data</button></footer>
      <BottomNav view={view} page={page} onNavigate={navigate} onAdd={() => setModal('add')} />
      {modal === 'add' && <AddClothing session={session} userId={userId} onClose={() => setModal('')} onSaved={async () => {
        setModal('')
        setFilter('All')
        setView('wardrobe')
        try {
          await refresh()
        } catch (error) {
          setNotice(`Your clothing items were saved, but the wardrobe could not refresh: ${error.message}`)
        }
      }} />}
      {modal === 'outfit' && <OutfitBuilder clothes={clothes} userId={userId} onClose={() => setModal('')} onSaved={async () => { await refresh(); setModal(''); setView('outfits') }} />}
      {modal === 'edit-outfit' && selectedOutfit && <OutfitBuilder clothes={clothes} userId={userId} outfit={selectedOutfit} onClose={() => setModal('')} onSaved={async () => { await refresh(); setModal(''); setSelectedOutfit(null); setView('outfits') }} />}
      {selectedItem && <ClothingDetails item={selectedItem} onClose={() => setSelectedItem(null)} onDelete={removeClothing} onEdit={(item) => { setSelectedItem(null); setEditingItem(item) }} />}
      {editingItem && <ClothingEditor item={editingItem} onClose={() => setEditingItem(null)} onSaved={async (item) => { setClothes((current) => current.map((piece) => piece.id === item.id ? { ...piece, ...item } : piece)); setEditingItem(null); await refresh() }} />}
      {selectedOutfit && !modal && <OutfitDetails outfit={selectedOutfit} onClose={() => setSelectedOutfit(null)} onEdit={() => setModal('edit-outfit')} />}
    </div>
  }

  const visible = filter === 'All' ? clothes : clothes.filter((item) => item.category === filter)
  return <div className="modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="modal-panel outfit-panel" role="dialog" aria-modal="true" aria-labelledby="outfit-title"><div className="modal-heading"><div><div className="eyebrow">OUTFIT BUILDER</div><h2 id="outfit-title">{outfit ? 'Edit your outfit' : 'Put a look together'}</h2></div><button className="icon-button close-button" aria-label="Close" onClick={onClose}>×</button></div><label className="outfit-name">Outfit name<input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} /></label><div className="builder-layout"><div className="builder-pieces"><div className="builder-label">YOUR PIECES <span>TAP OR DRAG TO CANVAS</span></div><div className="builder-piece-list">{clothes.map((item) => <button key={item.id} className="builder-piece" draggable onClick={() => addItem(item.id)} onDragStart={(event) => event.dataTransfer.setData('text/plain', String(item.id))}><img src={item.image_url} alt="" /><span>{item.category}<small>{item.dominant_color || item.clothing_type || 'Piece'}</small></span></button>)}</div></div><div className="outfit-canvas" onDragOver={(event) => event.preventDefault()} onDrop={drop}><span className="canvas-label">CANVAS <span>{selected.length} PIECES</span></span>{selected.length ? <div className="canvas-items">{selected.map((item) => <div className="canvas-piece" key={item.id}><img src={item.image_url} alt={item.category} /><button className="icon-button" title="Remove from outfit" aria-label="Remove from outfit" onClick={() => setSelected((current) => current.filter((piece) => piece.id !== item.id))}>×</button><small>{item.category}</small></div>)}</div> : <div className="canvas-empty"><span>＋</span><strong>Drop a piece here</strong><small>Start with something you love.</small></div>}</div></div>{error && <p className="form-error" role="alert">{error}</p>}  <div className="modal-actions"><button className="button button-quiet" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={busy || !selected.length}>{busy ? 'Saving…' : outfit ? 'Save changes' : 'Save outfit'}</button></div></section></div>
}
