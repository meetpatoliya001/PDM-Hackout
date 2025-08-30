
import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.heat';

// Firebase modular SDK (placeholder - requires env vars)
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, addDoc, onSnapshot, query, where, serverTimestamp } from 'firebase/firestore';
import { getStorage, ref as storageRef, uploadBytes } from 'firebase/storage';

// Simple helper to load env and init firebase
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FB_API_KEY,
  authDomain: import.meta.env.VITE_FB_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FB_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FB_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FB_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FB_APP_ID
};

let fbApp, auth, db, storage;
try {
  fbApp = initializeApp(firebaseConfig);
  auth = getAuth(fbApp);
  db = getFirestore(fbApp);
  storage = getStorage(fbApp);
} catch (e) {
  // If firebase already initialized in HMR, this will throw — ignore in dev
}

// ---------- HeatmapMap component ----------
function HeatmapMap({ center = [21.0, 72.6], zoom = 10 }) {
  const mapRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    const map = L.map('map', { center, zoom });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    const heat = L.heatLayer([], { radius: 25, blur: 15, maxZoom: 17 }).addTo(map);

    mapRef.current = { map, heat };
    setMapReady(true);

    // Firestore live listener (if db available)
    let unsub = () => {};
    if (db) {
      const q = query(collection(db, 'reports'));
      unsub = onSnapshot(q, (snap) => {
        const points = [];
        snap.forEach(doc => {
          const r = doc.data();
          if (r.lat && r.lng) {
            const intensity = Math.max(0.2, (r.severity || 3) / 5);
            points.push([r.lat, r.lng, intensity]);
          }
        });
        heat.setLatLngs(points);
      });
    }

    return () => {
      unsub();
      map.remove();
    };
  }, []);

  return (
    <div className="w-full h-[70vh] rounded-xl shadow" id="map" />
  );
}

// ---------- EnvironmentalLayers (WMS overlay toggle) ----------
function EnvironmentalLayers({ mapRef }) {
  const [on, setOn] = useState(false);
  const layerRef = useRef(null);
  useEffect(() => {
    if (!mapRef?.current || !mapRef.current.map) return;
    const map = mapRef.current.map;
    const wmsUrl = import.meta.env.VITE_WMS_URL; // set in .env if available
    const wmsLayerName = import.meta.env.VITE_WMS_LAYER;
    if (!wmsUrl || !wmsLayerName) return;

    if (on && !layerRef.current) {
      const overlay = L.tileLayer.wms(wmsUrl, {
        layers: wmsLayerName,
        format: 'image/png',
        transparent: true,
        opacity: 0.6
      }).addTo(map);
      layerRef.current = overlay;
    }
    if (!on && layerRef.current) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }
    return () => {
      if (layerRef.current) map.removeLayer(layerRef.current);
    };
  }, [on, mapRef]);

  return (
    <div className="flex items-center gap-3">
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={on} onChange={() => setOn(s => !s)} className="accent-sky-500" />
        <span className="text-sm">Environmental Overlay</span>
      </label>
    </div>
  );
}

// ---------- ReportForm component ----------
function ReportForm({ onSubmitted }) {
  const [file, setFile] = useState(null);
  const [type, setType] = useState('cutting');
  const [desc, setDesc] = useState('');
  const [severity, setSeverity] = useState(3);
  const [latLng, setLatLng] = useState(null);
  const [status, setStatus] = useState('idle');

  useEffect(() => {
    // try to get current position (graceful)
    if (!('geolocation' in navigator)) return;
    navigator.geolocation.getCurrentPosition((pos) => {
      setLatLng([pos.coords.latitude, pos.coords.longitude]);
    }, () => {}, { enableHighAccuracy: true });
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setStatus('saving');
    try {
      if (!db) throw new Error('Firestore not configured');
      const user = auth?.currentUser;

      // If user is not signed in, we'll allow anonymous submit in demo
      const reporterUid = user ? user.uid : 'anonymous';

      // If file present, upload to Storage
      let photoPath = null;
      if (file && storage) {
        const path = `reports/${reporterUid}/${Date.now()}-${file.name}`;
        const ref = storageRef(storage, path);
        await uploadBytes(ref, file);
        photoPath = path;
      }

      await addDoc(collection(db, 'reports'), {
        reporterUid,
        type,
        desc,
        lat: latLng ? latLng[0] : 0,
        lng: latLng ? latLng[1] : 0,
        photoPath,
        severity: Number(severity),
        status: 'pending',
        source: 'citizen',
        createdAt: serverTimestamp()
      });

      setStatus('done');
      setFile(null); setDesc(''); setSeverity(3);
      onSubmitted && onSubmitted();
    } catch (err) {
      console.error(err);
      setStatus('error');
      // Fallback: if offline, store locally (simple LocalStorage queued item)
      const queued = JSON.parse(localStorage.getItem('queuedReports') || '[]');
      queued.push({ fileName: file?.name, type, desc, severity, latLng, createdAt: Date.now() });
      localStorage.setItem('queuedReports', JSON.stringify(queued));
      setStatus('queued');
    }
  }

  return (
    <form onSubmit={handleSubmit} className="p-4 bg-white rounded-xl shadow space-y-3">
      <h3 className="font-semibold">Report an Incident</h3>
      <div>
        <label className="text-sm">Type</label>
        <select value={type} onChange={(e)=>setType(e.target.value)} className="w-full p-2 border rounded">
          <option value="cutting">Mangrove Cutting</option>
          <option value="dumping">Illegal Dumping</option>
          <option value="other">Other</option>
        </select>
      </div>

      <div>
        <label className="text-sm">Photo (optional)</label>
        <input type="file" accept="image/*" onChange={(e)=>setFile(e.target.files[0])} className="w-full" />
      </div>

      <div>
        <label className="text-sm">Description</label>
        <textarea value={desc} onChange={(e)=>setDesc(e.target.value)} className="w-full p-2 border rounded" rows={3} />
      </div>

      <div className="flex gap-2">
        <label className="flex-1">
          <div className="text-sm">Severity: {severity}</div>
          <input type="range" min={1} max={5} value={severity} onChange={(e)=>setSeverity(e.target.value)} className="w-full" />
        </label>
        <div className="w-36">
          <div className="text-sm">Location</div>
          <div className="text-xs text-gray-600">{latLng ? `${latLng[0].toFixed(4)}, ${latLng[1].toFixed(4)}` : 'Not available'}</div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <button type="submit" className="px-4 py-2 bg-sky-500 text-white rounded">Submit Report</button>
        <div className="text-sm text-gray-600">{status}</div>
      </div>
    </form>
  );
}

// ---------- Leaderboard component ----------
function Leaderboard() {
  const [top, setTop] = useState([]);

  useEffect(() => {
    if (!db) return;
    const lbRef = collection(db, 'leaderboards');
    // For demo: fetch latest leaderboard by created date — simple approach
    const unsub = onSnapshot(lbRef, (snap) => {
      // pick the most recent doc
      const docs = [];
      snap.forEach(d => docs.push({ id: d.id, ...d.data() }));
      if (docs.length === 0) return;
      docs.sort((a,b) => (a.weekStartISO || '') < (b.weekStartISO || '') ? 1 : -1);
      const latest = docs[0];
      // fetch scores subcollection
      const scoresRef = collection(db, `leaderboards/${latest.weekStartISO}/scores`);
      onSnapshot(scoresRef, (s2) => {
        const arr = [];
        s2.forEach(d => arr.push({ id: d.id, ...d.data() }));
        arr.sort((a,b) => (a.rank || 99) - (b.rank || 99));
        setTop(arr.slice(0,10));
      });
    });
    return () => unsub();
  }, []);

  return (
    <div className="p-4 bg-white rounded-xl shadow">
      <h3 className="font-semibold">Top Protectors of the Week</h3>
      <ol className="mt-3 space-y-2">
        {top.length === 0 && <div className="text-sm text-gray-500">No leaderboard yet</div>}
        {top.map((u, idx) => (
          <li key={u.id} className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center">{u.displayName?.charAt(0) || 'U'}</div>
            <div className="flex-1">
              <div className="text-sm font-medium">{u.displayName}</div>
              <div className="text-xs text-gray-500">{u.points} pts</div>
            </div>
            <div className="text-sm font-semibold">#{u.rank}</div>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ---------- Header ----------
function Header({ user, onLogin, onLogout }) {
  return (
    <header className="flex items-center justify-between py-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-sky-500 text-white flex items-center justify-center font-bold">MW</div>
        <div>
          <div className="font-bold">Community Mangrove Watch</div>
          <div className="text-xs text-gray-500">Protect. Report. Restore.</div>
        </div>
      </div>
      <div>
        {user ? (
          <div className="flex items-center gap-3">
            <div className="text-sm">{user.displayName}</div>
            <button onClick={onLogout} className="px-3 py-1 border rounded">Logout</button>
          </div>
        ) : (
          <button onClick={onLogin} className="px-3 py-1 bg-sky-500 text-white rounded">Sign in with Google</button>
        )}
      </div>
    </header>
  );
}

// ---------- Main App ----------
export default function App() {
  const [user, setUser] = useState(null);
  const mapRef = useRef(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!auth) return;
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u ? { uid: u.uid, displayName: u.displayName || 'User' } : null);
    });
    return () => unsub();
  }, []);

  async function handleLogin() {
    if (!auth) return alert('Auth not configured');
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (e) { console.error(e); }
  }

  async function handleLogout() {
    if (!auth) return;
    await auth.signOut();
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-6xl mx-auto">
        <Header user={user} onLogin={handleLogin} onLogout={handleLogout} />

        <main className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <section className="lg:col-span-2 space-y-4">
            {/* Map Box */}
            <div className="bg-white p-4 rounded-xl shadow">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold">Live Map & Heatmap</h2>
                <div className="flex items-center gap-3">
                  {/* environmental overlay toggle could be moved into a shared state via context; for demo we keep local */}
                </div>
              </div>
              <HeatmapMap />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <ReportForm onSubmitted={() => setRefreshKey(k=>k+1)} />
              </div>

              <div>
                <div className="p-4 bg-white rounded-xl shadow">
                  <h3 className="font-semibold">Map Layers</h3>
                  <p className="text-sm text-gray-500">Toggle external layers and environmental overlays.</p>
                  {/* For demo we render a simple toggle connected to the map via a small hack */}
                  <EnvironmentalLayers mapRef={mapRef} />
                </div>

                <div className="mt-4">
                  <Leaderboard />
                </div>
              </div>
            </div>
          </section>

          <aside className="space-y-4">
            <div className="p-4 bg-white rounded-xl shadow">
              <h3 className="font-semibold">Quick Actions</h3>
              <ul className="mt-3 space-y-2 text-sm text-gray-600">
                <li>• Submit Report (with photo & location)</li>
                <li>• Offline queue visible when network is lost</li>
                <li>• Leaderboard updates when moderators verify reports</li>
              </ul>
            </div>

            <div className="p-4 bg-white rounded-xl shadow">
              <h3 className="font-semibold">About</h3>
              <p className="text-sm text-gray-600">This frontend is a demo-ready React+Tailwind PWA skeleton for the Community Mangrove Watch. Connect Firebase & the backend functions to fully enable offline queueing, uploads, and leaderboards.</p>
            </div>
          </aside>
        </main>
      </div>
    </div>
  );
}

// End of file



