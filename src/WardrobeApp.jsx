import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase, supabaseConfigured } from './supabase'
import './wardrobe.css'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000/api'
const BUCKET = import.meta.env.VITE_SUPABASE_BUCKET || 'wardrobe-images'
const TERMS_VERSION = '1.0'
const PRIVACY_VERSION = '1.0'
const categories = ['All pieces', 'Tops', 'Bottoms', 'Dresses', 'Outerwear', 'Shoes', 'Accessories']
const categoryOptions = categories.slice(1)

function Mark() {
  return <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
}

function LegalPage({ privacy = false, onBack, onPrivacy }) {
  return <main className="legal-page"><button className="text-button back-link" onClick={onBack}>← Back to account</button><div className="eyebrow">THE FOLD / {privacy ? 'PRIVACY' : 'YOUR ACCOUNT'}</div><h1>{privacy ? 'Your wardrobe stays yours.' : 'Terms & conditions'}</h1><p className="legal-intro">{privacy ? 'A plain-language notice about personal data for The Fold.' : 'A straightforward agreement for keeping your personal wardrobe in one place.'}</p>
    {privacy ? <><section><h2>What we collect and why</h2><p>Your email, name and consent records support your account. Clothing photos and details are used to show your wardrobe and saved outfits. V0 has no advertising, analytics, precise location, or contacts collection.</p></section><section><h2>Where it is stored</h2><p>Account and wardrobe data are stored in Supabase Postgres. Compressed photos are stored in a private Supabase Storage bucket. Row-level security limits access to the signed-in account; FastAPI/Pillow only compresses an image after validating its Supabase session.</p></section><section><h2>Your choices and rights</h2><p>You can export your account data, update your name and clothing details, or delete your account. Account deletion also requests removal of your stored photos. Contact: <strong>Set PRIVACY_CONTACT_EMAIL before launch.</strong></p></section><section><h2>Security and retention</h2><p>Supabase Auth manages passwords and sessions. Images are re-encoded to strip embedded metadata. Data is kept while your account is active and removed on account deletion, subject to technical backup retention and records required by law.</p></section><section><h2>India</h2><p>The implementation supports data minimisation, purpose limitation, safeguards, consent records, and user control. The operator must confirm current DPDP Act and Rules obligations, retention requirements, grievance contact, and any transfer practices with qualified counsel before launch.</p></section><p className="legal-footnote">Privacy notice version 1.0 · Effective 26 September 2026</p></> : <><section><h2>Using The Fold</h2><p>The Fold is a private tool for cataloguing clothing and saving outfits. You must be at least 18 years old to create an account. Keep your sign-in details confidential and tell us promptly if you suspect unauthorised access.</p></section><section><h2>Your content</h2><p>You retain ownership of photos and details you add. You allow us to store and display them only to provide the wardrobe and outfit features you request. Photos are compressed for storage; we do not use AI recognition, train models, or generate recommendations.</p></section><section><h2>Privacy and account closure</h2><p>We use account and wardrobe information only to provide the service and protect accounts. You can export your data or delete your account at any time. Deletion removes account records and associated photos. Read our <button className="inline-link" onClick={onPrivacy}>Privacy notice</button>.</p></section><section><h2>Availability and changes</h2><p>The service is provided as available and may change as this early version develops. We will give notice of material changes. You may stop using the service and delete your account at any time.</p></section><section><h2>Contact and complaints</h2><p>For support, privacy requests, or complaints, contact the operator using the address in the Privacy notice or deployment configuration. The operator should acknowledge and address complaints promptly.</p></section><p className="legal-footnote">Effective 26 September 2026 · Terms version 1.0</p><p className="legal-disclaimer">This starter text is not legal advice. Have final terms reviewed for actual operations in India.</p></>}
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
  return Promise.all(outfits.map(async (outfit) => {
    const { data: links, error: linksError } = await supabase
      .from('outfit_items')
      .select('position, clothing_items(*)')
      .eq('outfit_id', outfit.id)
      .order('position')
    if (linksError) throw linksError
    const items = await Promise.all(links.map(async ({ clothing_items: item }) => {
      const { data: signed, error: signedError } = await supabase.storage.from(BUCKET).createSignedUrl(item.image_path, 3600)
      if (signedError) throw signedError
      return { ...item, image_url: signed.signedUrl }
    }))
    return { ...outfit, items }
  }))
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

function Auth({ onSignedIn }) {
  const [mode, setMode] = useState('login')
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
  return <main className="auth-layout"><section className="auth-art"><div className="auth-art-top"><Mark /><span>PERSONAL WARDROBE / V0</span></div><div className="fabric-scene" aria-hidden="true"><div className="garment garment-one" /><div className="garment garment-two" /><div className="garment garment-three" /><div className="hanger" /><span className="scene-tag">01 — YOURS, BY DESIGN</span></div><div className="art-caption"><span>LESS SEARCHING.</span><span>MORE GETTING DRESSED.</span></div><div className="auth-art-footer"><span>PRIVATE BY DEFAULT</span><span>MADE FOR YOUR EVERYDAY</span></div></section><section className="auth-panel"><div className="auth-mobile-brand"><Mark /><span>THE FOLD</span></div><div className="auth-form-wrap"><div className="eyebrow">YOUR CLOSET, IN GOOD ORDER</div><h1>{mode === 'login' ? <>Come on<br />in.</> : <>Make room<br />for more.</>}</h1><p className="auth-copy">{mode === 'login' ? 'A little more clarity, every morning.' : 'Start with the pieces you reach for.'}</p><form className="auth-form" onSubmit={submit}>{mode === 'signup' && <label>Your name<input type="text" autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} /></label>}<label>Email address<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254} /></label><label>Password<input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(event) => setPassword(event.target.value)} required minLength={mode === 'signup' ? 12 : 1} maxLength={128} /><small>{mode === 'signup' ? 'Use at least 12 characters.' : 'Your password is managed securely by Supabase Auth.'}</small></label>{mode === 'signup' && <label className="consent-row"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} required /><span>I am 18 or older, agree to the <button type="button" className="inline-link" onClick={() => setLegal('terms')}>Terms &amp; Conditions</button>, and have read the <button type="button" className="inline-link" onClick={() => setLegal('privacy')}>Privacy notice</button>.</span></label>}{error && <p className="form-error" role="alert">{error}</p>}{message && <p className="profile-saved" role="status">{message}</p>}<button className="button button-primary auth-submit" disabled={busy || (mode === 'signup' && (!accepted || !name.trim()))}>{busy ? 'One moment…' : mode === 'login' ? 'Sign in' : 'Create account'}<span aria-hidden="true">↗</span></button></form><div className="auth-switch">{mode === 'login' ? 'New around here?' : 'Already have an account?'} <button className="inline-link" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); setMessage('') }}>{mode === 'login' ? 'Create an account' : 'Sign in'}</button></div><p className="auth-privacy-note"><span className="lock-dot" /> Your photos stay private. No AI, no ads, no recommendations.</p></div><footer className="auth-bottom"><button className="text-button" onClick={() => setLegal('privacy')}>Privacy</button><span>© THE FOLD 2026</span><button className="text-button" onClick={() => setLegal('terms')}>Terms</button></footer></section></main>
}

function ProfilePage({ profile, email, onBack, onSaved }) {
  const [name, setName] = useState(profile?.full_name || '')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  async function submit(event) {
    event.preventDefault()
    setError('')
    setSaved(false)
    setBusy(true)
    try {
      const { data, error: updateError } = await supabase.from('profiles').update({ full_name: name.trim() }).eq('id', profile.id).select().single()
      if (updateError) throw updateError
      onSaved(data)
      setSaved(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  return <main className="profile-page"><button className="text-button back-link" onClick={onBack}>← Back to wardrobe</button><div className="eyebrow">YOUR ACCOUNT</div><h1>Your profile</h1><p className="legal-intro">Manage the name shown with your wardrobe.</p><form className="profile-form" onSubmit={submit}><label>Full name<input value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} autoComplete="name" /></label><label>Email address<input value={email} readOnly /></label>{error && <p className="form-error" role="alert">{error}</p>}{saved && <p className="profile-saved" role="status">Profile saved.</p>}<button className="button button-primary" disabled={busy || !name.trim()}>{busy ? 'Saving…' : 'Save profile'}</button></form></main>
}

function ClothingCard({ item, onDelete, onDragStart }) {
  return <article className="clothing-card" draggable onDragStart={(event) => onDragStart(event, item)}><div className="clothing-image"><img src={item.image_url} alt={`${item.category}${item.color ? `, ${item.color}` : ''}`} loading="lazy" /><button className="icon-button delete-piece" title="Remove clothing" aria-label="Remove clothing" onClick={() => onDelete(item)}>×</button></div><div className="clothing-details"><div><strong>{item.category}</strong><span>{item.color || item.subcategory || 'Piece'}</span></div><span className="category-dot" /></div></article>
}

function AddClothing({ session, userId, onClose, onSaved }) {
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState('')
  const [category, setCategory] = useState('Tops')
  const [color, setColor] = useState('')
  const [subcategory, setSubcategory] = useState('')
  const [season, setSeason] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  function chooseFile(next) {
    if (!next) return
    if (preview) URL.revokeObjectURL(preview)
    setFile(next)
    setPreview(URL.createObjectURL(next))
    setError('')
  }
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])
  async function submit(event) {
    event.preventDefault()
    if (!file) { setError('Choose a photo to continue.'); return }
    setBusy(true)
    setError('')
    const imagePath = `${userId}/${crypto.randomUUID()}.webp`
    try {
      const compressed = await compressPhoto(file, session)
      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(imagePath, compressed, { contentType: 'image/webp', cacheControl: '3600', upsert: false })
      if (uploadError) {
        if (uploadError.message.toLowerCase().includes('mime type image/webp is not supported')) {
          throw new Error(`The ${BUCKET} bucket must allow image/webp uploads. In Supabase Storage, edit the bucket's allowed MIME types to include image/webp, then retry.`)
        }
        throw uploadError
      }
      const { error: insertError } = await supabase.from('clothing_items').insert({ user_id: userId, image_path: imagePath, category, color: color.trim(), subcategory: subcategory.trim(), season, notes: notes.trim() })
      if (insertError) {
        const { error: cleanupError } = await supabase.storage.from(BUCKET).remove([imagePath])
        if (cleanupError) throw new Error(`Clothing details were not saved and the uploaded photo could not be cleaned up: ${cleanupError.message}`)
        throw insertError
      }
      await onSaved()
    } catch (err) {
      setError(err.message || 'Could not save this clothing item.')
    } finally {
      setBusy(false)
    }
  }
  return <div className="modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="modal-panel add-panel" role="dialog" aria-modal="true" aria-labelledby="add-title"><div className="modal-heading"><div><div className="eyebrow">A NEW PIECE</div><h2 id="add-title">Add to your wardrobe</h2></div><button className="icon-button close-button" aria-label="Close" onClick={onClose}>×</button></div><form onSubmit={submit}><label className={`upload-zone${preview ? ' has-preview' : ''}`}>{preview ? <img src={preview} alt="Selected clothing preview" /> : <><span className="upload-icon">＋</span><strong>Choose a photo or take one</strong><span>JPG, PNG or WebP · up to 8 MB</span></>}<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(event) => chooseFile(event.target.files?.[0])} /></label><div className="form-grid"><label>Category<select value={category} onChange={(event) => setCategory(event.target.value)}>{categoryOptions.map((option) => <option key={option}>{option}</option>)}</select></label><label>Color<input value={color} onChange={(event) => setColor(event.target.value)} maxLength={40} placeholder="e.g. forest green" /></label><label>Type<input value={subcategory} onChange={(event) => setSubcategory(event.target.value)} maxLength={60} placeholder="e.g. linen shirt" /></label><label>Season<select value={season} onChange={(event) => setSeason(event.target.value)}><option value="">Any season</option><option>Spring</option><option>Summer</option><option>Autumn</option><option>Winter</option><option>All season</option></select></label><label className="wide-field">Notes<textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={500} rows={2} placeholder="Fit, fabric, or anything you want to remember" /></label></div>{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="button button-quiet" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? 'Compressing & saving…' : 'Save piece'}</button></div></form></section></div>
}

function OutfitBuilder({ clothes, userId, onClose, onSaved }) {
  const [selected, setSelected] = useState([])
  const [name, setName] = useState('Everyday outfit')
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
      const { data: outfit, error: outfitError } = await supabase.from('outfits').insert({ user_id: userId, name: name.trim() }).select().single()
      if (outfitError) throw outfitError
      const { error: itemsError } = await supabase.from('outfit_items').insert(selected.map((item, position) => ({ outfit_id: outfit.id, clothing_id: item.id, position })))
      if (itemsError) {
        const { error: cleanupError } = await supabase.from('outfits').delete().eq('id', outfit.id)
        if (cleanupError) throw new Error(`Outfit items could not be saved and cleanup failed: ${cleanupError.message}`)
        throw itemsError
      }
      await onSaved()
    } catch (err) { setError(err.message || 'Could not save the outfit.') } finally { setBusy(false) }
  }
  return <div className="modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="modal-panel outfit-panel" role="dialog" aria-modal="true" aria-labelledby="outfit-title"><div className="modal-heading"><div><div className="eyebrow">OUTFIT BUILDER</div><h2 id="outfit-title">Put a look together</h2></div><button className="icon-button close-button" aria-label="Close" onClick={onClose}>×</button></div><label className="outfit-name">Outfit name<input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} /></label><div className="builder-layout"><div className="builder-pieces"><div className="builder-label">YOUR PIECES <span>TAP OR DRAG TO CANVAS</span></div><div className="builder-piece-list">{clothes.map((item) => <button key={item.id} className="builder-piece" draggable onClick={() => addItem(item.id)} onDragStart={(event) => event.dataTransfer.setData('text/plain', String(item.id))}><img src={item.image_url} alt="" /><span>{item.category}<small>{item.color || item.subcategory || 'Piece'}</small></span></button>)}</div></div><div className="outfit-canvas" onDragOver={(event) => event.preventDefault()} onDrop={drop}><span className="canvas-label">CANVAS <span>{selected.length} PIECES</span></span>{selected.length ? <div className="canvas-items">{selected.map((item) => <div className="canvas-piece" key={item.id}><img src={item.image_url} alt={item.category} /><button className="icon-button" title="Remove from outfit" aria-label="Remove from outfit" onClick={() => setSelected((current) => current.filter((piece) => piece.id !== item.id))}>×</button><small>{item.category}</small></div>)}</div> : <div className="canvas-empty"><span>＋</span><strong>Drop a piece here</strong><small>Start with something you love.</small></div>}</div></div>{error && <p className="form-error" role="alert">{error}</p>}  <div className="modal-actions"><button className="button button-quiet" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={!selected.length || !name.trim() || busy} onClick={save}>{busy ? 'Saving…' : 'Save outfit'}</button></div></section></div>
}

export default function WardrobeApp() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [clothes, setClothes] = useState([])
  const [outfits, setOutfits] = useState([])
  const [view, setView] = useState('wardrobe')
  const [page, setPage] = useState('app')
  const [filter, setFilter] = useState('All pieces')
  const [modal, setModal] = useState('')
  const [busy, setBusy] = useState(supabaseConfigured)
  const [notice, setNotice] = useState('')
  const activeUserId = useRef(null)
  const user = session?.user
  const userId = user?.id
  const applySession = useCallback((nextSession) => {
    activeUserId.current = nextSession?.user.id ?? null
    setSession(nextSession)
  }, [])

  const refresh = useCallback(async () => {
    if (!userId) return
    const [wardrobe, saved, profileResult] = await Promise.all([
      loadClothing(userId),
      loadOutfits(userId),
      supabase.from('profiles').select('*').eq('id', userId).single(),
    ])
    if (profileResult.error) throw profileResult.error
    if (activeUserId.current !== userId) return
    setClothes(wardrobe)
    setOutfits(saved)
    setProfile(profileResult.data)
  }, [userId])

  useEffect(() => {
    if (!supabaseConfigured) return undefined
    let active = true
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) throw error
      if (active) {
        applySession(data.session)
        if (!data.session) setBusy(false)
      }
    }).catch((error) => {
      if (active) {
        setNotice(error.message)
        setBusy(false)
      }
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      applySession(nextSession)
      if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') setBusy(Boolean(nextSession))
      if (!nextSession) {
        setBusy(false)
        setProfile(null)
        setClothes([])
        setOutfits([])
      }
    })
    return () => { active = false; subscription.unsubscribe() }
  }, [applySession])

  useEffect(() => {
    if (!userId) return undefined
    let active = true
    refresh().catch((error) => {
      if (active) setNotice(error.message)
    }).finally(() => {
      if (active) setBusy(false)
    })
    return () => { active = false }
  }, [userId, refresh])

  async function removeClothing(item) {
    if (!window.confirm('Remove this clothing piece?')) return
    try {
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
        supabase.from('clothing_items').select('id,category,color,subcategory,season,notes,created_at').eq('user_id', userId),
        supabase.from('outfits').select('id,name,created_at').eq('user_id', userId),
        supabase.from('outfit_items').select('outfit_id,clothing_id,position'),
        supabase.from('consent_records').select('consent_type,version,accepted_at').eq('user_id', userId),
      ])
      for (const result of [items, savedOutfits, links, consent]) if (result.error) throw result.error
      const payload = { profile, consent: consent.data, clothing: items.data, outfits: savedOutfits.data.map((outfit) => ({ ...outfit, clothing_ids: links.data.filter((link) => link.outfit_id === outfit.id).sort((a, b) => a.position - b.position).map((link) => link.clothing_id) })), exported_at: new Date().toISOString() }
      const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url
      link.download = 'the-fold-data.json'
      link.click()
      URL.revokeObjectURL(url)
    } catch (error) { setNotice(error.message) }
  }

  async function deleteAccount() {
    if (!window.confirm('Delete your account, wardrobe details, outfits, and stored photos? This cannot be undone.')) return
    try {
      const objects = []
      for (let offset = 0; ; offset += 100) {
        const { data, error } = await supabase.storage.from(BUCKET).list(userId, { limit: 100, offset })
        if (error) throw error
        objects.push(...data.map((object) => `${userId}/${object.name}`))
        if (data.length < 100) break
      }
      for (let offset = 0; offset < objects.length; offset += 100) {
        const { error } = await supabase.storage.from(BUCKET).remove(objects.slice(offset, offset + 100))
        if (error) throw error
      }
      const { error } = await supabase.rpc('delete_my_account')
      if (error) throw error
      await supabase.auth.signOut({ scope: 'local' })
    } catch (error) { setNotice(error.message) }
  }

  async function logout() {
    const { error } = await supabase.auth.signOut()
    if (error) setNotice(error.message)
  }

  if (!supabaseConfigured) return <main className="legal-page"><div className="eyebrow">THE FOLD / SETUP</div><h1>Supabase is not configured.</h1><p className="legal-intro">Create a local <code>.env.local</code> from the provided example and set the Supabase project URL and publishable key. Follow <code>SUPABASE_SETUP.md</code> to create the database tables, private image bucket and access policies.</p></main>
  if (busy) return <div className="loading-screen"><Mark /><span>Opening your wardrobe…</span></div>
  if (page === 'profile' && user && !profile) return <main className="profile-page"><button className="text-button back-link" onClick={() => setPage('app')}>← Back to wardrobe</button><div className="eyebrow">YOUR ACCOUNT</div><h1>Profile unavailable</h1><p className="legal-intro">Your profile could not be loaded. Return to the wardrobe and try again.</p>{notice && <p className="form-error" role="alert">{notice}</p>}</main>
  if (page === 'profile' && user) return <ProfilePage profile={profile} email={user.email} onBack={() => setPage('app')} onSaved={setProfile} />
  if (page === 'privacy') return <LegalPage privacy onBack={() => setPage(user ? 'app' : 'auth')} />
  if (!session) return <Auth onSignedIn={applySession} />

  const visible = filter === 'All pieces' ? clothes : clothes.filter((item) => item.category === filter)
  return <div className="app-shell"><header className="topbar"><button className="wordmark" onClick={() => { setPage('app'); setView('wardrobe') }}><Mark /><span>THE FOLD<small>YOUR WARDROBE, WELL KEPT</small></span></button><nav className="top-nav"><button className={view === 'wardrobe' ? 'nav-active' : ''} onClick={() => setView('wardrobe')}>Wardrobe <span>{clothes.length}</span></button><button className={view === 'outfits' ? 'nav-active' : ''} onClick={() => setView('outfits')}>Outfits <span>{outfits.length}</span></button></nav><div className="account-menu"><span className="user-avatar">{(profile?.full_name || user.email)?.slice(0, 1).toUpperCase()}</span><span className="user-email">{profile?.full_name || user.email}</span><details><summary aria-label="Account menu">···</summary><div className="account-dropdown"><button onClick={() => setPage('profile')}>Your profile</button><button onClick={exportData}>Export my data</button><button onClick={() => setPage('privacy')}>Privacy notice</button><button onClick={logout}>Sign out</button><button className="danger-action" onClick={deleteAccount}>Delete account</button></div></details></div></header><main className="workspace"><div className="page-heading"><div><div className="eyebrow">{view === 'wardrobe' ? 'A CLEARER VIEW OF WHAT YOU OWN' : 'MADE FROM WHAT YOU HAVE'}</div><h1>{view === 'wardrobe' ? 'Your wardrobe' : 'Saved outfits'}<span className="heading-count">{view === 'wardrobe' ? clothes.length : outfits.length}</span></h1><p>{view === 'wardrobe' ? 'Every piece, in its place.' : 'Looks worth coming back to.'}</p></div><div className="heading-actions">{view === 'wardrobe' && <button className="button button-outline" onClick={() => setModal('outfit')} disabled={!clothes.length}>＋ Build an outfit</button>}<button className="button button-primary" onClick={() => setModal('add')}>＋ Add a piece</button></div></div>{notice && <div className="notice" role="status">{notice}<button className="text-button" onClick={() => setNotice('')}>Dismiss</button></div>}{view === 'wardrobe' ? <><div className="filter-row" role="group" aria-label="Filter by category">{categories.map((category) => <button key={category} className={`filter-chip${filter === category ? ' selected' : ''}`} onClick={() => setFilter(category)}>{category}{category === 'All pieces' && <span>{clothes.length}</span>}</button>)}</div>{visible.length ? <div className="clothing-grid">{visible.map((item) => <ClothingCard key={item.id} item={item} onDelete={removeClothing} onDragStart={(event, piece) => event.dataTransfer.setData('text/plain', String(piece.id))} />)}</div> : <section className="empty-state"><div className="empty-art"><div className="empty-hanger" /><div className="empty-shirt" /><div className="empty-trouser" /></div><div className="eyebrow">A LITTLE SPACE TO START</div><h2>{filter === 'All pieces' ? 'Your wardrobe starts here.' : `No ${filter.toLowerCase()} yet.`}</h2><p>Add a photo and the details you care about. Your pieces stay private.</p><button className="button button-primary" onClick={() => setModal('add')}>＋ Add your first piece</button></section>}</> : <section className="outfits-view">{outfits.length ? <div className="saved-outfit-grid">{outfits.map((outfit) => <article className="saved-outfit" key={outfit.id}><div className="saved-outfit-images">{outfit.items.slice(0, 3).map((item) => <img key={item.id} src={item.image_url} alt="" />)}</div><div className="saved-outfit-caption"><strong>{outfit.name}</strong><span>{outfit.items.length} {outfit.items.length === 1 ? 'piece' : 'pieces'}</span></div></article>)}</div> : <section className="empty-state"><div className="eyebrow">A LOOK OF YOUR OWN</div><h2>No outfits saved yet.</h2><p>Drag pieces from your wardrobe onto a canvas and save a combination.</p><button className="button button-primary" onClick={() => setView('wardrobe')}>View wardrobe</button></section>}</section>}</main><footer className="workspace-footer"><span>YOUR PHOTOS ARE PRIVATE · NO AI · NO ADS</span><button className="text-button" onClick={() => setPage('privacy')}>Privacy &amp; data</button></footer>{modal === 'add' && <AddClothing session={session} userId={userId} onClose={() => setModal('')} onSaved={async () => { await refresh(); setModal(''); setFilter('All pieces') }} />}{modal === 'outfit' && <OutfitBuilder clothes={clothes} userId={userId} onClose={() => setModal('')} onSaved={async () => { await refresh(); setModal(''); setView('outfits') }} />}</div>
}
