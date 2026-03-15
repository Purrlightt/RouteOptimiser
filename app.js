const T_KEY = CONFIG.MAPTILER_KEY;
const O_KEY = CONFIG.ORS_KEY;
let userLoc = null, queue = [], markers = [];

const map = new maplibregl.Map({
    container: 'map',
    style: `https://api.maptiler.com/maps/streets-v2-dark/style.json?key=${T_KEY}`,
    center: [9.617, 52.415], zoom: 15
});

const geolocate = new maplibregl.GeolocateControl({
    positionOptions: { enableHighAccuracy: true },
    trackUserLocation: true, showUserHeading: true
});
map.addControl(geolocate);
geolocate.on('geolocate', (e) => userLoc = [e.coords.longitude, e.coords.latitude]);

function addToQueue() {
    const street = document.getElementById('streetInput').value.trim();
    const plz = document.getElementById('plzSelect').value;
    if (!street) return;
    queue.push({ street, plz, coords: null });
    renderUI();
    document.getElementById('streetInput').value = "";
}

function renderUI() {
    const list = document.getElementById('addressQueue');
    list.innerHTML = queue.map((item, i) => `
        <div class="queue-item">
            <span><b>${item.plz}</b> ${item.street} ${item.coords ? '✅' : '⏳'}</span>
            <span onclick="removeIdx(${i})" style="color:#ff4444; font-weight:bold;">X</span>
        </div>
    `).join('');
}

function removeIdx(i) { queue.splice(i, 1); renderUI(); }

// BUTTON 1: LOAD PINS INSTANTLY
async function loadPins() {
    markers.forEach(m => m.remove());
    markers = [];
    
    for (let i = 0; i < queue.length; i++) {
        const query = encodeURIComponent(`${queue[i].street}, ${queue[i].plz} Garbsen, Germany`);
        try {
            const r = await fetch(`https://api.maptiler.com/geocoding/${query}.json?key=${T_KEY}&limit=1`);
            const d = await r.json();
            if (d.features.length > 0) {
                const pt = d.features[0].center;
                queue[i].coords = pt; // Store for routing
                
                const el = document.createElement('div');
                el.className = 'house-marker';
                el.innerHTML = i + 1;
                const m = new maplibregl.Marker(el).setLngLat(pt).addTo(map);
                markers.push(m);
            }
        } catch (e) { console.error("Geocode failed"); }
    }
    renderUI(); // Show checkmarks in list
}

// BUTTON 2: START OPTIMAL ROUTE
async function startOptimalRoute() {
    const validStops = queue.filter(q => q.coords).map(q => q.coords);
    if (validStops.length === 0 || !userLoc) return alert("Load Pins and wait for GPS lock first!");

    try {
        const optResp = await fetch(`https://api.openrouteservice.org/optimization`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': O_KEY },
            body: JSON.stringify({
                jobs: validStops.map((c, i) => ({ id: i, location: c })),
                vehicles: [{ id: 0, profile: "cycling-regular", start: userLoc }]
            })
        });
        const optData = await optResp.json();
        const optimizedPath = optData.routes[0].steps.map(s => s.location);

        const routeResp = await fetch(`https://api.openrouteservice.org/v2/directions/cycling-regular/geojson`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': O_KEY },
            body: JSON.stringify({ coordinates: optimizedPath })
        });
        const routeData = await routeResp.json();
        
        if (map.getSource('route')) map.getSource('route').setData(routeData);
        else {
            map.addSource('route', { type: 'geojson', data: routeData });
            map.addLayer({ id: 'route', type: 'line', source: 'route', paint: { 'line-color': '#00f2ff', 'line-width': 5 } });
        }
        
        const bounds = new maplibregl.LngLatBounds();
        optimizedPath.forEach(c => bounds.extend(c));
        map.fitBounds(bounds, { padding: 50 });
        
    } catch (e) { alert("Routing engine busy. Try again in a second."); }
}

map.on('load', () => { geolocate.trigger(); map.resize(); });
