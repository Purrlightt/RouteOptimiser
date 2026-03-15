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
    queue.push({ street, plz });
    renderUI();
    document.getElementById('streetInput').value = "";
}

function renderUI() {
    const list = document.getElementById('addressQueue');
    list.innerHTML = queue.map((item, i) => `
        <div class="queue-item">
            <span><b>${item.plz}</b> ${item.street}</span>
            <span onclick="queue.splice(${i},1);renderUI();" style="color:red">REMOVE</span>
        </div>
    `).join('');
}

async function startOptimalRoute() {
    if (queue.length === 0 || !userLoc) return alert("Waiting for GPS lock...");
    
    // 1. Instant Marker Update
    markers.forEach(m => m.remove());
    markers = [];
    
    // Start Geocoding all addresses in parallel
    const coords = await Promise.all(queue.map(async (item) => {
        const query = encodeURIComponent(`${item.street}, ${item.plz} Garbsen, Germany`);
        const r = await fetch(`https://api.maptiler.com/geocoding/${query}.json?key=${T_KEY}&limit=1`);
        const d = await r.json();
        return d.features.length > 0 ? d.features[0].center : null;
    }));

    const validCoords = coords.filter(c => c !== null);
    
    // 2. Immediate Pin Drop
    validCoords.forEach((pt, i) => {
        const el = document.createElement('div');
        el.className = 'house-marker';
        el.innerHTML = i + 1;
        markers.push(new maplibregl.Marker(el).setLngLat(pt).addTo(map));
    });

    // 3. Optimization & Pathing
    try {
        const optResp = await fetch(`https://api.openrouteservice.org/optimization`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': O_KEY },
            body: JSON.stringify({
                jobs: validCoords.map((c, i) => ({ id: i, location: c })),
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
    } catch (e) { console.error("Routing Error"); }
}

map.on('load', () => { geolocate.trigger(); map.resize(); });
