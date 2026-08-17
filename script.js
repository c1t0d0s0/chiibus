/**
 * 港区ちぃばす マップ & 時刻表 (Minato City Chiibus Map & Timetable)
 * Modern Transit Application with GTFS Shapes, Timetable Matrix, Real-time Countdown & Mobile Bottom Sheet
 */

(function () {
    'use strict';

    // Minato City Coordinates
    const MINATO_CENTER = [35.655, 139.735];
    const DEFAULT_ZOOM = 14;

    // Chiibus Official Route Theme Colors
    const ROUTE_COLORS = {
        '00001': '#d32f2f', // 赤坂: クリムゾンレッド
        '00002': '#1976d2', // 田町: オーシャンブルー
        '00003': '#2e7d32', // 芝: フォレストグリーン
        '00004': '#e65100', // 麻布東: サンセットオレンジ
        '00005': '#7b1fa2', // 麻布西: ディープパープル
        '00006': '#00838f', // 青山: ティール
        '00007': '#d97706', // 高輪: アンバーゴールド
        '00008': '#c2185b', // 芝浦港南: ローズマゼンタ
        'default': '#2563eb'
    };

    // DOM Elements
    const mapEl = document.getElementById('map');
    const sidebarEl = document.getElementById('sidebar');
    const stopListEl = document.getElementById('stop-list');
    const searchInput = document.getElementById('search-input');
    const searchClearBtn = document.getElementById('search-clear');
    const routeSelectEl = document.getElementById('route-select');
    const directionSelectEl = document.getElementById('direction-select');
    const routeIndicator = document.getElementById('route-indicator');
    const stopCountLabel = document.getElementById('stop-count-label');
    const fitBoundsBtn = document.getElementById('fit-bounds-btn');
    const geoLocateBtn = document.getElementById('geo-locate-btn');
    const mapResetBtn = document.getElementById('map-reset-btn');
    const activeRoutePill = document.getElementById('active-route-pill');
    const activeRouteDot = document.getElementById('active-route-dot');
    const activeRouteText = document.getElementById('active-route-text');
    const activeRouteDir = document.getElementById('active-route-dir');
    const currentClockEl = document.getElementById('current-clock');

    // Detail Panel Elements
    const detailPanel = document.getElementById('stop-detail-panel');
    const detailBackdrop = document.getElementById('detail-backdrop');
    const detailCloseBtn = document.getElementById('detail-close-btn');
    const detailStopName = document.getElementById('detail-stop-name');
    const detailStopKana = document.getElementById('detail-stop-kana');
    const detailRoutesTags = document.getElementById('detail-routes-tags');
    const detailFocusBtn = document.getElementById('detail-focus-btn');
    const nextBusList = document.getElementById('next-bus-list');
    const nextBusClock = document.getElementById('next-bus-clock');
    const timetableMatrix = document.getElementById('timetable-matrix');
    const timetableFilterInfo = document.getElementById('timetable-filter-info');
    const dayTabs = document.getElementById('day-tabs');

    // Mobile Sheet Elements
    const mobileSheet = document.getElementById('mobile-sheet');
    const sheetHandleBar = document.getElementById('sheet-handle-bar');
    const sheetHeader = document.getElementById('sheet-header');
    const sheetContent = document.getElementById('sheet-content');
    const sheetTitle = document.getElementById('sheet-title');
    const sheetRouteDot = document.getElementById('sheet-route-dot');
    const sheetCountBadge = document.getElementById('sheet-count-badge');

    // Initialize Leaflet Map
    const map = L.map('map', {
        zoomControl: false
    }).setView(MINATO_CENTER, DEFAULT_ZOOM);

    // Zoom control in top right
    L.control.zoom({ position: 'topright' }).addTo(map);

    // Map Tile Layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
        maxZoom: 19
    }).addTo(map);

    // Map Layers
    const polylineLayer = L.layerGroup().addTo(map);
    const markersLayer = L.layerGroup().addTo(map);
    const userLocationLayer = L.layerGroup().addTo(map);

    // Application State
    let routesData = [];
    let tripsData = [];
    let stopTimesData = [];
    let stopsData = [];
    let calendarData = [];
    let calendarDatesData = [];
    let shapesData = {};
    let translationsData = {};

    let allStops = [];
    let visibleStops = [];
    let markers = [];
    let currentSelectedStop = null;
    let currentSelectedDayType = 'today'; // 'today' | 'weekday' | 'saturday' | 'holiday'
    let currentActiveRouteId = '';
    let currentActiveDirection = '';

    let routeIdToStopIds = {};
    let routeIdToTripIds = {};
    let routeDirections = {};
    let directionStopIds = {};
    let directionTripIds = {};
    let tripIdToOrderedStopIds = {};
    let tripIdToServiceId = {};
    let tripIdToShapeId = {};
    let stopIdToCoord = {};
    let stopTimesByStopId = {};
    let stopIdToRouteIds = {};
    let serviceIdsToday = {};
    let userLocation = null;

    // Helper: CSV Parser
    function parseCSV(text) {
        if (!text) return [];
        const lines = text.trim().split(/\r?\n/);
        if (lines.length < 2) return [];
        const header = lines[0].split(',').map(function (h) { return h.trim(); });
        const rows = [];
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i];
            if (!line) continue;
            // Parse comma-separated line handling potential double quotes
            const cols = [];
            let inQuotes = false;
            let currentCol = '';
            for (let c = 0; c < line.length; c++) {
                const char = line[c];
                if (char === '"') {
                    inQuotes = !inQuotes;
                } else if (char === ',' && !inQuotes) {
                    cols.push(currentCol.trim());
                    currentCol = '';
                } else {
                    currentCol += char;
                }
            }
            cols.push(currentCol.trim());

            const row = {};
            header.forEach(function (h, j) {
                row[h] = cols[j] != null ? cols[j].replace(/^"|"$/g, '').trim() : '';
            });
            rows.push(row);
        }
        return rows;
    }

    // Helper: Escape HTML
    function escapeHtml(s) {
        if (!s) return '';
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // Helper: Kana / Romaji normalizer for search
    function normalizeSearchText(str) {
        if (!str) return '';
        // Convert Katakana to Hiragana and lowercase
        return str
            .replace(/[\u30a1-\u30f6]/g, function (match) {
                var chr = match.charCodeAt(0) - 0x60;
                return String.fromCharCode(chr);
            })
            .toLowerCase()
            .trim();
    }

    // Build Translations Map
    function buildTranslations(translationsRaw) {
        const out = {};
        translationsRaw.forEach(function (r) {
            const val = r.field_value || r.translation || '';
            const lang = r.language || '';
            const trans = r.translation || '';
            if (!val) return;
            if (!out[val]) out[val] = { kana: '', en: '' };
            if (lang === 'ja-Hrkt') out[val].kana = trans;
            if (lang === 'en') out[val].en = trans;
        });
        return out;
    }

    // Build Shapes Map from shapes.txt
    function buildShapes(shapesRaw) {
        const out = {};
        shapesRaw.forEach(function (r) {
            const sid = r.shape_id;
            const lat = parseFloat(r.shape_pt_lat);
            const lon = parseFloat(r.shape_pt_lon);
            const seq = parseInt(r.shape_pt_sequence, 10);
            if (!sid || isNaN(lat) || isNaN(lon)) return;
            if (!out[sid]) out[sid] = [];
            out[sid].push({ lat: lat, lon: lon, seq: isNaN(seq) ? 0 : seq });
        });
        // Sort each shape sequence
        Object.keys(out).forEach(function (sid) {
            out[sid].sort(function (a, b) { return a.seq - b.seq; });
            out[sid] = out[sid].map(function (pt) { return [pt.lat, pt.lon]; });
        });
        return out;
    }

    // Build Stops with Translations & Connecting Routes
    function buildStops(rawStops, translations) {
        const byName = {};
        rawStops.forEach(function (r) {
            const name = r.stop_name || '';
            const lat = parseFloat(r.stop_lat);
            const lon = parseFloat(r.stop_lon);
            if (!name || isNaN(lat) || isNaN(lon)) return;
            if (!byName[name]) {
                const trans = translations[name] || {};
                byName[name] = {
                    name: name,
                    lat: lat,
                    lon: lon,
                    ids: [],
                    kana: trans.kana || '',
                    en: trans.en || '',
                    routes: []
                };
            }
            if (byName[name].ids.indexOf(r.stop_id) === -1) {
                byName[name].ids.push(r.stop_id);
            }
        });
        return Object.keys(byName).sort(function (a, b) {
            return a.localeCompare(b, 'ja');
        }).map(function (k) { return byName[k]; });
    }

    // Build Stop ID to Coordinates
    function buildStopIdToCoord(stopsRaw) {
        const out = {};
        stopsRaw.forEach(function (r) {
            const id = r.stop_id;
            const lat = parseFloat(r.stop_lat);
            const lon = parseFloat(r.stop_lon);
            if (id && !isNaN(lat) && !isNaN(lon)) {
                out[id] = [lat, lon];
            }
        });
        return out;
    }

    // Build Route ID to Stop IDs & Stop ID to Route IDs
    function buildRouteStopRelations(tripsRaw, stopTimesRaw) {
        const routeToTrips = {};
        tripsRaw.forEach(function (r) {
            const rid = r.route_id;
            const tid = r.trip_id;
            if (!rid || !tid) return;
            if (!routeToTrips[rid]) routeToTrips[rid] = [];
            routeToTrips[rid].push(tid);
        });

        const tripToStops = {};
        stopTimesRaw.forEach(function (r) {
            const tid = r.trip_id;
            const sid = r.stop_id;
            if (!tid || !sid) return;
            if (!tripToStops[tid]) tripToStops[tid] = [];
            tripToStops[tid].push(sid);
        });

        const routeToStops = {};
        const stopToRoutes = {};

        Object.keys(routeToTrips).forEach(function (rid) {
            const set = {};
            routeToTrips[rid].forEach(function (tid) {
                (tripToStops[tid] || []).forEach(function (sid) {
                    set[sid] = true;
                    if (!stopToRoutes[sid]) stopToRoutes[sid] = {};
                    stopToRoutes[sid][rid] = true;
                });
            });
            routeToStops[rid] = set;
        });

        return { routeToStops: routeToStops, stopToRoutes: stopToRoutes };
    }

    // Build Route Directions with Shape IDs
    function buildRouteDirections(tripsRaw) {
        const byRoute = {};
        tripsRaw.forEach(function (r) {
            const rid = r.route_id;
            const tid = r.trip_id;
            const headsign = (r.trip_headsign || '').trim();
            const shapeId = r.shape_id || '';
            if (!rid || !tid || !headsign) return;
            if (!byRoute[rid]) byRoute[rid] = {};
            if (!byRoute[rid][headsign]) {
                byRoute[rid][headsign] = { tripId: tid, shapeId: shapeId };
            }
        });

        const result = {};
        Object.keys(byRoute).forEach(function (rid) {
            result[rid] = Object.keys(byRoute[rid]).map(function (h) {
                return {
                    headsign: h,
                    tripId: byRoute[rid][h].tripId,
                    shapeId: byRoute[rid][h].shapeId
                };
            });
        });
        return result;
    }

    // Build Direction Stops & Trips
    function buildDirectionRelations(tripsRaw, stopTimesRaw) {
        const routeHeadsignToTrips = {};
        tripsRaw.forEach(function (r) {
            const rid = r.route_id;
            const tid = r.trip_id;
            const headsign = (r.trip_headsign || '').trim();
            if (!rid || !tid || !headsign) return;
            const key = rid + '\t' + headsign;
            if (!routeHeadsignToTrips[key]) routeHeadsignToTrips[key] = [];
            routeHeadsignToTrips[key].push(tid);
        });

        const tripToStops = {};
        stopTimesRaw.forEach(function (r) {
            const tid = r.trip_id;
            const sid = r.stop_id;
            if (!tid || !sid) return;
            if (!tripToStops[tid]) tripToStops[tid] = [];
            tripToStops[tid].push(sid);
        });

        const dirStopIds = {};
        Object.keys(routeHeadsignToTrips).forEach(function (key) {
            const set = {};
            routeHeadsignToTrips[key].forEach(function (tid) {
                (tripToStops[tid] || []).forEach(function (sid) { set[sid] = true; });
            });
            dirStopIds[key] = set;
        });

        return { dirStopIds: dirStopIds, dirTripIds: routeHeadsignToTrips };
    }

    // Build Trip to Ordered Stop IDs
    function buildTripIdToOrderedStopIds(stopTimesRaw) {
        const byTrip = {};
        stopTimesRaw.forEach(function (r) {
            const tid = r.trip_id;
            const sid = r.stop_id;
            const seq = parseInt(r.stop_sequence, 10);
            if (!tid || !sid || isNaN(seq)) return;
            if (!byTrip[tid]) byTrip[tid] = [];
            byTrip[tid].push({ seq: seq, stopId: sid });
        });
        const result = {};
        Object.keys(byTrip).forEach(function (tid) {
            byTrip[tid].sort(function (a, b) { return a.seq - b.seq; });
            result[tid] = byTrip[tid].map(function (x) { return x.stopId; });
        });
        return result;
    }

    // Date & Calendar Logic
    const DAY_NAMES = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    function getTodayYyyymmdd() {
        const d = new Date();
        const y = d.getFullYear();
        const m = d.getMonth() + 1;
        const s = d.getDate();
        return '' + y + (m < 10 ? '0' : '') + m + (s < 10 ? '0' : '') + s;
    }

    function getServiceIdsForDate(calendarRaw, calendarDatesRaw, yyyymmdd) {
        const set = {};
        const y = parseInt(yyyymmdd.slice(0, 4), 10);
        const m = parseInt(yyyymmdd.slice(4, 6), 10) - 1;
        const day = parseInt(yyyymmdd.slice(6, 8), 10);
        const weekday = new Date(y, m, day).getDay();
        const dayCol = DAY_NAMES[(weekday + 6) % 7];
        calendarRaw.forEach(function (r) {
            const sid = r.service_id;
            if (!sid) return;
            if (r.start_date && r.end_date && yyyymmdd >= r.start_date && yyyymmdd <= r.end_date && r[dayCol] === '1') {
                set[sid] = true;
            }
        });
        (calendarDatesRaw || []).forEach(function (r) {
            if (r.date !== yyyymmdd) return;
            const sid = r.service_id;
            const ex = parseInt(r.exception_type, 10);
            if (ex === 1) set[sid] = true;
            else if (ex === 2) delete set[sid];
        });
        return set;
    }

    // Get Active Service IDs based on day tab ('today' | 'weekday' | 'saturday' | 'holiday')
    function getActiveServiceIds(dayType) {
        if (dayType === 'today') {
            return serviceIdsToday;
        }
        const set = {};
        if (dayType === 'weekday') {
            set['01'] = true;
        } else if (dayType === 'saturday') {
            set['03'] = true;
        } else if (dayType === 'holiday') {
            set['06'] = true;
        }
        return set;
    }

    // Build Stop Times dictionary
    function buildStopTimesByStopId(stopTimesRaw) {
        const out = {};
        stopTimesRaw.forEach(function (r) {
            const sid = r.stop_id;
            const tid = r.trip_id;
            const dep = r.departure_time || r.arrival_time || '';
            if (!sid || !tid || !dep) return;
            if (!out[sid]) out[sid] = [];
            out[sid].push({ tripId: tid, time: dep });
        });
        return out;
    }

    // Get Route Name by routeId
    function getRouteName(routeId) {
        const r = routesData.find(function (x) { return x.route_id === routeId; });
        return r ? (r.route_short_name || r.route_long_name || routeId) : routeId;
    }

    // Get Route Color by routeId
    function getRouteColor(routeId) {
        return ROUTE_COLORS[routeId] || ROUTE_COLORS.default;
    }

    // Format current time HH:MM
    function getCurrentTimeString() {
        const now = new Date();
        const h = String(now.getHours()).padStart(2, '0');
        const m = String(now.getMinutes()).padStart(2, '0');
        return h + ':' + m;
    }

    // Calculate Minutes Difference between "HH:MM" and current time
    function getMinutesDiffFromNow(timeStr) {
        const now = new Date();
        const nowMinutes = now.getHours() * 60 + now.getMinutes();
        const parts = timeStr.split(':');
        const targetMinutes = parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
        return targetMinutes - nowMinutes;
    }

    // Timetable Computation
    function getTimetableForStop(stop, routeId, directionHeadsign, dayType) {
        const activeServices = getActiveServiceIds(dayType || currentSelectedDayType);
        
        let targetTripIds = [];
        if (routeId) {
            if (directionHeadsign) {
                targetTripIds = directionTripIds[routeId + '\t' + directionHeadsign] || [];
            } else {
                targetTripIds = routeIdToTripIds[routeId] || [];
            }
        } else {
            // All routes passing through this stop
            stop.routes.forEach(function (rid) {
                (routeIdToTripIds[rid] || []).forEach(function (tid) {
                    targetTripIds.push(tid);
                });
            });
        }

        // Filter trips active in current day type
        const tripSet = {};
        targetTripIds.forEach(function (tid) {
            const sid = tripIdToServiceId[tid];
            if (activeServices[sid]) tripSet[tid] = true;
        });

        // Collect departure times from all stop physical poles
        const departures = [];
        stop.ids.forEach(function (sid) {
            (stopTimesByStopId[sid] || []).forEach(function (item) {
                if (tripSet[item.tripId]) {
                    const trip = tripsData.find(function (t) { return t.trip_id === item.tripId; });
                    departures.push({
                        time: item.time.slice(0, 5),
                        tripId: item.tripId,
                        routeId: trip ? trip.route_id : '',
                        headsign: trip ? trip.trip_headsign : ''
                    });
                }
            });
        });

        departures.sort(function (a, b) {
            return a.time.localeCompare(b.time);
        });

        // Deduplicate departures by time and headsign
        const seen = {};
        const uniqueDepartures = [];
        departures.forEach(function (d) {
            const key = d.time + '\t' + d.headsign;
            if (!seen[key]) {
                seen[key] = true;
                uniqueDepartures.push(d);
            }
        });

        return uniqueDepartures;
    }

    // Render Matrix Timetable
    function renderTimetableMatrix(departures) {
        if (!departures || departures.length === 0) {
            timetableMatrix.innerHTML = '<div class="empty-state">該当する運行ダイヤがありません</div>';
            return;
        }

        const currentHour = new Date().getHours();
        const currentTimeStr = getCurrentTimeString();
        const byHour = {};

        departures.forEach(function (d) {
            const parts = d.time.split(':');
            const h = parseInt(parts[0], 10);
            const m = parts[1];
            if (!byHour[h]) byHour[h] = [];
            byHour[h].push({
                minute: m,
                time: d.time,
                headsign: d.headsign,
                routeId: d.routeId,
                isPast: d.time < currentTimeStr,
                isNext: false
            });
        });

        // Find next upcoming trip
        let nextFound = false;
        if (currentSelectedDayType === 'today') {
            for (let h = currentHour; h < 24; h++) {
                if (byHour[h]) {
                    for (let i = 0; i < byHour[h].length; i++) {
                        if (byHour[h][i].time >= currentTimeStr) {
                            byHour[h][i].isNext = true;
                            nextFound = true;
                            break;
                        }
                    }
                }
                if (nextFound) break;
            }
        }

        const sortedHours = Object.keys(byHour).map(Number).sort(function (a, b) { return a - b; });
        let html = '';

        sortedHours.forEach(function (h) {
            const isCurrent = h === currentHour;
            const isPast = h < currentHour;
            const rowClass = 'timetable-row' + (isCurrent ? ' is-current-hour' : '') + (isPast ? ' is-past-hour' : '');
            const hStr = String(h).padStart(2, '0');

            html += '<div class="' + rowClass + '">';
            html += '<div class="timetable-hour">' + hStr + '</div>';
            html += '<div class="timetable-minutes">';
            
            byHour[h].forEach(function (m) {
                let chipClass = 'minute-chip';
                if (m.isNext && currentSelectedDayType === 'today') chipClass += ' is-next';
                else if (m.isPast && currentSelectedDayType === 'today') chipClass += ' is-past';

                const routeCol = getRouteColor(m.routeId);
                html += '<span class="' + chipClass + '" title="' + escapeHtml(m.headsign) + ' (' + m.time + ')">';
                html += m.minute;
                if (!currentActiveRouteId && m.headsign) {
                    html += '<span class="minute-chip-dest">' + escapeHtml(m.headsign.slice(0, 2)) + '</span>';
                }
                html += '</span>';
            });

            html += '</div></div>';
        });

        timetableMatrix.innerHTML = html;
    }

    // Render Upcoming Departures (Next Bus Countdown Card)
    function renderNextBusCard(stop) {
        const nowStr = getCurrentTimeString();
        nextBusClock.textContent = '現在時刻 ' + nowStr;

        const departures = getTimetableForStop(stop, currentActiveRouteId, currentActiveDirection, 'today');
        const upcoming = departures.filter(function (d) { return d.time >= nowStr; }).slice(0, 3);

        if (upcoming.length === 0) {
            nextBusList.innerHTML = '<div class="next-bus-empty">本日の運行は終了しました</div>';
            return;
        }

        let html = '';
        upcoming.forEach(function (item) {
            const diff = getMinutesDiffFromNow(item.time);
            const routeName = getRouteName(item.routeId);
            const routeColor = getRouteColor(item.routeId);
            const isImminent = diff <= 5;
            
            let countdownText = 'あと ' + diff + ' 分';
            if (diff === 0) countdownText = 'まもなく発車';
            else if (diff < 0) countdownText = '発車済';

            html += '<div class="next-bus-item" style="border-left-color: ' + routeColor + ';">';
            html += '  <div class="next-bus-info">';
            html += '    <span class="next-bus-time">' + escapeHtml(item.time) + '</span>';
            html += '    <div class="next-bus-meta">';
            html += '      <div class="next-bus-dest">' + escapeHtml(item.headsign || routeName) + '</div>';
            html += '    </div>';
            html += '  </div>';
            html += '  <span class="next-bus-countdown' + (isImminent ? ' imminent' : '') + '">' + countdownText + '</span>';
            html += '</div>';
        });

        nextBusList.innerHTML = html;
    }

    // Open Stop Detail Panel
    function openStopDetail(stop) {
        currentSelectedStop = stop;
        detailStopName.textContent = stop.name;
        detailStopKana.textContent = stop.kana || stop.en || '';

        // Render Route Badges
        detailRoutesTags.innerHTML = '';
        (stop.routes || []).forEach(function (rid) {
            const rName = getRouteName(rid);
            const rColor = getRouteColor(rid);
            const tag = document.createElement('span');
            tag.className = 'route-tag';
            tag.style.backgroundColor = rColor;
            tag.textContent = rName;
            detailRoutesTags.appendChild(tag);
        });

        // Render Next Bus & Timetable
        renderNextBusCard(stop);
        const departures = getTimetableForStop(stop, currentActiveRouteId, currentActiveDirection, currentSelectedDayType);
        renderTimetableMatrix(departures);

        // Update Timetable filter subtext
        const routeLabel = currentActiveRouteId ? getRouteName(currentActiveRouteId) : '全系統';
        timetableFilterInfo.textContent = routeLabel + (currentActiveDirection ? ' (' + currentActiveDirection + ')' : '');

        detailPanel.classList.add('open');
        detailPanel.setAttribute('aria-hidden', 'false');

        // On mobile, expand bottom sheet to full if open
        if (window.innerWidth <= 768) {
            setSheetState('full');
        }
    }

    // Close Stop Detail Panel
    function closeStopDetail() {
        detailPanel.classList.remove('open');
        detailPanel.setAttribute('aria-hidden', 'true');
        currentSelectedStop = null;
    }

    // Build Custom SVG Bus Marker Icon
    function createBusMarkerIcon(seq, color, isActive) {
        const text = seq != null ? String(seq) : '';
        const bg = color || ROUTE_COLORS.default;
        const activeClass = isActive ? ' active' : '';

        const html = '<div class="bus-marker-pin' + activeClass + '" style="background-color: ' + bg + ';">' +
            (text ? text : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2m10-10h-2M4 12H2"/></svg>') +
            '</div>';

        return L.divIcon({
            className: 'custom-bus-marker',
            html: html,
            iconSize: [28, 28],
            iconAnchor: [14, 14],
            popupAnchor: [0, -16]
        });
    }

    // Update Map Markers
    function updateMarkers() {
        markersLayer.clearLayers();
        markers = [];

        const routeId = currentActiveRouteId;
        const routeColor = getRouteColor(routeId);

        visibleStops.forEach(function (stop, i) {
            const seqNumber = routeId ? (i + 1) : null;
            const icon = createBusMarkerIcon(seqNumber, routeColor, currentSelectedStop && currentSelectedStop.name === stop.name);

            const m = L.marker([stop.lat, stop.lon], { icon: icon })
                .on('click', function () {
                    highlightStopInList(stop.name);
                    openStopDetail(stop);
                });

            // Add tooltip with Stop Name
            m.bindTooltip(stop.name, {
                direction: 'top',
                offset: [0, -14],
                className: 'leaflet-custom-tooltip'
            });

            markers.push(m);
            markersLayer.addLayer(m);
        });
    }

    // Draw Route Shape Polyline from shapes.txt or stop coords
    function updateRoutePolyline() {
        polylineLayer.clearLayers();

        const routeId = currentActiveRouteId;
        const directionHeadsign = currentActiveDirection;
        if (!routeId || !directionHeadsign || !routeDirections[routeId]) {
            activeRoutePill.hidden = true;
            return;
        }

        const dir = routeDirections[routeId].find(function (d) { return d.headsign === directionHeadsign; });
        if (!dir) {
            activeRoutePill.hidden = true;
            return;
        }

        const routeColor = getRouteColor(routeId);
        const routeName = getRouteName(routeId);

        // Update floating pill
        activeRoutePill.hidden = false;
        activeRouteDot.style.backgroundColor = routeColor;
        activeRouteText.textContent = routeName;
        activeRouteDir.textContent = '▶ ' + directionHeadsign;

        let coords = [];
        // Try high-resolution shape geometry first
        if (dir.shapeId && shapesData[dir.shapeId] && shapesData[dir.shapeId].length > 0) {
            coords = shapesData[dir.shapeId];
        } else if (tripIdToOrderedStopIds[dir.tripId]) {
            // Fallback to ordered stop coordinates
            const stopIds = tripIdToOrderedStopIds[dir.tripId];
            for (let i = 0; i < stopIds.length; i++) {
                const c = stopIdToCoord[stopIds[i]];
                if (c) coords.push(c);
            }
        }

        if (coords.length > 1) {
            // Polyline Outline / Casing for High Contrast
            L.polyline(coords, {
                color: '#ffffff',
                weight: 8,
                opacity: 0.85,
                lineCap: 'round',
                lineJoin: 'round'
            }).addTo(polylineLayer);

            // Main Route Line
            const mainLine = L.polyline(coords, {
                color: routeColor,
                weight: 5,
                opacity: 1,
                lineCap: 'round',
                lineJoin: 'round'
            }).addTo(polylineLayer);

            // Fit bounds smoothly with padding
            map.fitBounds(mainLine.getBounds(), {
                padding: [40, 40],
                maxZoom: 16,
                animate: true
            });
        }
    }

    // Highlight Stop in List and Scroll into View
    function highlightStopInList(stopName) {
        document.querySelectorAll('.stop-item.highlight').forEach(function (el) {
            el.classList.remove('highlight');
        });

        const items = document.querySelectorAll('.stop-item');
        for (let i = 0; i < items.length; i++) {
            if (items[i].dataset.name === stopName) {
                items[i].classList.add('highlight');
                items[i].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                break;
            }
        }
    }

    // Render Stop List
    function renderList(stops, searchQuery) {
        const q = normalizeSearchText(searchQuery);
        const filtered = q
            ? stops.filter(function (s) {
                const matchName = normalizeSearchText(s.name).indexOf(q) !== -1;
                const matchKana = normalizeSearchText(s.kana).indexOf(q) !== -1;
                const matchEn = normalizeSearchText(s.en).indexOf(q) !== -1;
                return matchName || matchKana || matchEn;
            })
            : stops;

        stopCountLabel.textContent = filtered.length + ' 停留所';
        sheetCountBadge.textContent = filtered.length + ' 件';

        if (filtered.length === 0) {
            stopListEl.innerHTML = '<div class="empty-state"><p>該当する停留所が見つかりません</p></div>';
            return;
        }

        stopListEl.innerHTML = '';
        const nowStr = getCurrentTimeString();
        const routeId = currentActiveRouteId;
        const routeColor = getRouteColor(routeId);

        filtered.forEach(function (stop, idx) {
            const seqNum = routeId ? (idx + 1) : null;
            const div = document.createElement('div');
            div.className = 'stop-item' + (currentSelectedStop && currentSelectedStop.name === stop.name ? ' highlight' : '');
            div.dataset.name = stop.name;

            let nextBusBadgeHtml = '';
            if (routeId) {
                const departures = getTimetableForStop(stop, routeId, currentActiveDirection, 'today');
                const nextTrip = departures.find(function (d) { return d.time >= nowStr; });
                if (nextTrip) {
                    const diff = getMinutesDiffFromNow(nextTrip.time);
                    const diffText = diff === 0 ? 'まもなく' : 'あと' + diff + '分';
                    nextBusBadgeHtml = '<span class="stop-item-next-bus">次 ' + nextTrip.time + ' (' + diffText + ')</span>';
                }
            }

            let routeTagsHtml = '';
            (stop.routes || []).forEach(function (rid) {
                const rColor = getRouteColor(rid);
                const rName = getRouteName(rid);
                routeTagsHtml += '<span class="route-tag" style="background-color: ' + rColor + ';">' + escapeHtml(rName) + '</span>';
            });

            div.innerHTML =
                '<div class="stop-item-badge" style="' + (routeId ? 'background-color: ' + routeColor + '; color: #fff;' : '') + '">' +
                    (seqNum != null ? seqNum : (idx + 1)) +
                '</div>' +
                '<div class="stop-item-main">' +
                    (stop.kana ? '<span class="stop-item-kana">' + escapeHtml(stop.kana) + '</span>' : '') +
                    '<div class="stop-item-name">' + escapeHtml(stop.name) + '</div>' +
                    '<div class="stop-item-footer">' +
                        '<div class="stop-item-routes">' + routeTagsHtml + '</div>' +
                        nextBusBadgeHtml +
                    '</div>' +
                '</div>' +
                '<div class="stop-item-chevron">' +
                    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"></polyline></svg>' +
                '</div>';

            div.addEventListener('click', function () {
                highlightStopInList(stop.name);
                map.flyTo([stop.lat, stop.lon], 17, { duration: 0.8 });
                openStopDetail(stop);
            });

            stopListEl.appendChild(div);
        });
    }

    // Get Visible Stops based on current Route & Direction
    function getVisibleStops(routeId, directionHeadsign) {
        if (!routeId || !routeIdToStopIds[routeId]) {
            return allStops;
        }

        let stopIdSet = {};
        if (directionHeadsign) {
            stopIdSet = directionStopIds[routeId + '\t' + directionHeadsign] || {};
            // If direction has an ordered trip, preserve sequence
            const dir = (routeDirections[routeId] || []).find(function (d) { return d.headsign === directionHeadsign; });
            if (dir && tripIdToOrderedStopIds[dir.tripId]) {
                const orderedIds = tripIdToOrderedStopIds[dir.tripId];
                const seen = {};
                const orderedStops = [];
                orderedIds.forEach(function (sid) {
                    const match = allStops.find(function (s) { return s.ids.indexOf(sid) !== -1; });
                    if (match && !seen[match.name]) {
                        seen[match.name] = true;
                        orderedStops.push(match);
                    }
                });
                return orderedStops;
            }
        } else {
            stopIdSet = routeIdToStopIds[routeId] || {};
        }

        return allStops.filter(function (s) {
            return s.ids.some(function (id) { return stopIdSet[id]; });
        });
    }

    // Update Direction Dropdown options
    function updateDirectionDropdown(routeId) {
        directionSelectEl.innerHTML = '';
        const opt0 = document.createElement('option');
        opt0.value = '';
        opt0.textContent = routeId ? '-- 進行方向を選択 --' : '-- ルートを選択してください --';
        directionSelectEl.appendChild(opt0);

        if (!routeId) {
            directionSelectEl.disabled = true;
            return;
        }

        directionSelectEl.disabled = false;
        const dirs = routeDirections[routeId] || [];
        dirs.forEach(function (d, i) {
            const opt = document.createElement('option');
            opt.value = d.headsign;
            opt.textContent = d.headsign;
            // Default to first direction for convenience
            if (i === 0) {
                opt.selected = true;
            }
            directionSelectEl.appendChild(opt);
        });

        // If options exist, select the first one
        if (dirs.length > 0) {
            directionSelectEl.value = dirs[0].headsign;
        }
    }

    // Apply Route & Direction Filter
    let lastAppliedRouteId = '';
    function applyRouteFilter() {
        const routeId = routeSelectEl.value || '';
        currentActiveRouteId = routeId;

        if (routeId !== lastAppliedRouteId) {
            lastAppliedRouteId = routeId;
            updateDirectionDropdown(routeId);
        }

        currentActiveDirection = directionSelectEl.value || '';

        // Update Route Color Indicator
        const color = getRouteColor(routeId);
        routeIndicator.style.backgroundColor = routeId ? color : 'transparent';
        sheetRouteDot.style.backgroundColor = routeId ? color : 'var(--color-accent)';
        sheetTitle.textContent = routeId ? (getRouteName(routeId) + ' (' + (currentActiveDirection || '全方向') + ')') : '港区ちぃばす 停留所一覧';

        visibleStops = getVisibleStops(routeId, currentActiveDirection);
        updateMarkers();
        updateRoutePolyline();
        renderList(visibleStops, searchInput.value);

        // If detail panel is open, refresh its data
        if (currentSelectedStop) {
            renderNextBusCard(currentSelectedStop);
            const departures = getTimetableForStop(currentSelectedStop, currentActiveRouteId, currentActiveDirection, currentSelectedDayType);
            renderTimetableMatrix(departures);
        }
    }

    // Reset Map View to Center Bounds
    function fitMapToAllStops() {
        if (visibleStops.length === 0) return;
        const bounds = L.latLngBounds(visibleStops.map(function (s) { return [s.lat, s.lon]; }));
        map.fitBounds(bounds, { padding: [30, 30], animate: true });
    }

    // Geolocation / User Location Handling
    function handleGeoLocate() {
        if (!navigator.geolocation) {
            alert('お使いのブラウザは位置情報に対応していません。');
            return;
        }

        geoLocateBtn.style.opacity = '0.5';
        navigator.geolocation.getCurrentPosition(function (pos) {
            geoLocateBtn.style.opacity = '1';
            const lat = pos.coords.latitude;
            const lon = pos.coords.longitude;
            userLocation = [lat, lon];

            userLocationLayer.clearLayers();

            // Custom GPS Pulsing Dot
            const gpsIcon = L.divIcon({
                className: 'custom-gps-marker',
                html: '<div class="user-gps-marker"><div class="user-gps-pulse"></div><div class="user-gps-dot"></div></div>',
                iconSize: [20, 20],
                iconAnchor: [10, 10]
            });

            L.marker([lat, lon], { icon: gpsIcon }).addTo(userLocationLayer);

            // Find nearest stop using Haversine formula
            let nearestStop = null;
            let minDist = Infinity;
            allStops.forEach(function (s) {
                const dist = getDistanceInMeters(lat, lon, s.lat, s.lon);
                if (dist < minDist) {
                    minDist = dist;
                    nearestStop = s;
                }
            });

            map.flyTo([lat, lon], 16, { duration: 1 });

            if (nearestStop && minDist < 2000) {
                setTimeout(function () {
                    highlightStopInList(nearestStop.name);
                    openStopDetail(nearestStop);
                }, 800);
            }
        }, function (err) {
            geoLocateBtn.style.opacity = '1';
            alert('現在地を取得できませんでした: ' + err.message);
        }, { enableHighAccuracy: true, timeout: 8000 });
    }

    // Haversine Distance Helper
    function getDistanceInMeters(lat1, lon1, lat2, lon2) {
        const R = 6371e3;
        const φ1 = lat1 * Math.PI / 180;
        const φ2 = lat2 * Math.PI / 180;
        const Δφ = (lat2 - lat1) * Math.PI / 180;
        const Δλ = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
                  Math.cos(φ1) * Math.cos(φ2) *
                  Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    // Mobile Bottom Sheet Drag & Snap Handling
    let sheetState = 'collapsed'; // 'collapsed' | 'half' | 'full'
    function setSheetState(state) {
        sheetState = state;
        mobileSheet.classList.remove('collapsed', 'half', 'full');
        mobileSheet.classList.add(state);
    }

    function initMobileSheet() {
        let startY = 0;
        let currentY = 0;
        let isDragging = false;

        sheetHandleBar.addEventListener('touchstart', function (e) {
            startY = e.touches[0].clientY;
            isDragging = true;
        }, { passive: true });

        sheetHeader.addEventListener('click', function () {
            if (sheetState === 'collapsed') {
                setSheetState('half');
            } else if (sheetState === 'half') {
                setSheetState('full');
            } else {
                setSheetState('collapsed');
            }
        });

        window.addEventListener('touchmove', function (e) {
            if (!isDragging) return;
            currentY = e.touches[0].clientY;
        }, { passive: true });

        window.addEventListener('touchend', function () {
            if (!isDragging) return;
            isDragging = false;
            const diff = currentY - startY;
            if (diff < -50) {
                // Swiped Up
                if (sheetState === 'collapsed') setSheetState('half');
                else if (sheetState === 'half') setSheetState('full');
            } else if (diff > 50) {
                // Swiped Down
                if (sheetState === 'full') setSheetState('half');
                else if (sheetState === 'half') setSheetState('collapsed');
            }
        });
    }

    // Move Controls into Sheet on Mobile
    function syncLayoutForScreen() {
        const isMobile = window.innerWidth <= 768;
        if (isMobile) {
            if (!sheetContent.contains(stopListEl)) {
                // Move control card, search section, and stop list to mobile sheet
                const controlCard = document.querySelector('.control-card');
                const searchSection = document.querySelector('.search-section');
                if (controlCard) sheetContent.appendChild(controlCard);
                if (searchSection) sheetContent.appendChild(searchSection);
                if (stopListEl) sheetContent.appendChild(stopListEl);
            }
        } else {
            if (!sidebarEl.contains(stopListEl)) {
                // Move back to sidebar
                const controlCard = document.querySelector('.control-card');
                const searchSection = document.querySelector('.search-section');
                if (controlCard) sidebarEl.appendChild(controlCard);
                if (searchSection) sidebarEl.appendChild(searchSection);
                if (stopListEl) sidebarEl.appendChild(stopListEl);
            }
        }
    }

    // Setup Live Timer Interval
    function startClockTimer() {
        function updateTicker() {
            const nowStr = getCurrentTimeString();
            currentClockEl.textContent = '現在時刻 ' + nowStr;
            if (currentSelectedStop) {
                renderNextBusCard(currentSelectedStop);
            }
        }
        updateTicker();
        setInterval(updateTicker, 15000);
    }

    // Setup Event Listeners
    function setupEventListeners() {
        routeSelectEl.addEventListener('change', applyRouteFilter);
        directionSelectEl.addEventListener('change', applyRouteFilter);

        searchInput.addEventListener('input', function () {
            const val = searchInput.value;
            searchClearBtn.hidden = !val;
            renderList(visibleStops, val);
        });

        searchClearBtn.addEventListener('click', function () {
            searchInput.value = '';
            searchClearBtn.hidden = true;
            renderList(visibleStops, '');
            searchInput.focus();
        });

        fitBoundsBtn.addEventListener('click', fitMapToAllStops);
        geoLocateBtn.addEventListener('click', handleGeoLocate);
        mapResetBtn.addEventListener('click', function () {
            map.flyTo(MINATO_CENTER, DEFAULT_ZOOM, { duration: 0.8 });
        });

        detailCloseBtn.addEventListener('click', closeStopDetail);
        detailBackdrop.addEventListener('click', closeStopDetail);

        detailFocusBtn.addEventListener('click', function () {
            if (currentSelectedStop) {
                map.flyTo([currentSelectedStop.lat, currentSelectedStop.lon], 17, { duration: 0.8 });
                closeStopDetail();
            }
        });

        // Day switcher tabs
        dayTabs.addEventListener('click', function (e) {
            const tab = e.target.closest('.day-tab');
            if (!tab) return;
            dayTabs.querySelectorAll('.day-tab').forEach(function (t) {
                t.classList.remove('active');
                t.setAttribute('aria-selected', 'false');
            });
            tab.classList.add('active');
            tab.setAttribute('aria-selected', 'true');
            currentSelectedDayType = tab.dataset.day;

            if (currentSelectedStop) {
                const departures = getTimetableForStop(currentSelectedStop, currentActiveRouteId, currentActiveDirection, currentSelectedDayType);
                renderTimetableMatrix(departures);
            }
        });

        window.addEventListener('resize', syncLayoutForScreen);
    }

    // Fetch and Initialize GTFS Data
    Promise.all([
        fetch('gtfs/routes.txt').then(function (r) { if (!r.ok) throw new Error('routes.txt'); return r.text(); }),
        fetch('gtfs/trips.txt').then(function (r) { if (!r.ok) throw new Error('trips.txt'); return r.text(); }),
        fetch('gtfs/stop_times.txt').then(function (r) { if (!r.ok) throw new Error('stop_times.txt'); return r.text(); }),
        fetch('gtfs/stops.txt').then(function (r) { if (!r.ok) throw new Error('stops.txt'); return r.text(); }),
        fetch('gtfs/calendar.txt').then(function (r) { if (!r.ok) throw new Error('calendar.txt'); return r.text(); }),
        fetch('gtfs/calendar_dates.txt').then(function (r) { if (!r.ok) throw new Error('calendar_dates.txt'); return r.text(); }),
        fetch('gtfs/shapes.txt').then(function (r) { if (!r.ok) throw new Error('shapes.txt'); return r.text(); }),
        fetch('gtfs/translations.txt').then(function (r) { if (!r.ok) throw new Error('translations.txt'); return r.text(); })
    ]).then(function (texts) {
        routesData = parseCSV(texts[0]);
        tripsData = parseCSV(texts[1]);
        stopTimesData = parseCSV(texts[2]);
        stopsData = parseCSV(texts[3]);
        calendarData = parseCSV(texts[4]);
        calendarDatesData = parseCSV(texts[5]);
        const shapesRaw = parseCSV(texts[6]);
        const translationsRaw = parseCSV(texts[7]);

        translationsData = buildTranslations(translationsRaw);
        shapesData = buildShapes(shapesRaw);

        // Build indexes
        serviceIdsToday = getServiceIdsForDate(calendarData, calendarDatesData, getTodayYyyymmdd());
        
        const relations = buildRouteStopRelations(tripsData, stopTimesData);
        routeIdToStopIds = relations.routeToStops;
        stopIdToRouteIds = relations.stopToRoutes;

        routeDirections = buildRouteDirections(tripsData);
        const dirRel = buildDirectionRelations(tripsData, stopTimesData);
        directionStopIds = dirRel.dirStopIds;
        directionTripIds = dirRel.dirTripIds;

        tripIdToOrderedStopIds = buildTripIdToOrderedStopIds(stopTimesData);
        stopIdToCoord = buildStopIdToCoord(stopsData);
        stopTimesByStopId = buildStopTimesByStopId(stopTimesData);

        // Build Route ID to Trip IDs & Trip to Service ID
        tripsData.forEach(function (r) {
            const rid = r.route_id;
            const tid = r.trip_id;
            const sid = r.service_id;
            const shpid = r.shape_id;
            if (rid && tid) {
                if (!routeIdToTripIds[rid]) routeIdToTripIds[rid] = [];
                routeIdToTripIds[rid].push(tid);
            }
            if (tid && sid) tripIdToServiceId[tid] = sid;
            if (tid && shpid) tripIdToShapeId[tid] = shpid;
        });

        // Populate Stops with Routes
        allStops = buildStops(stopsData, translationsData);
        allStops.forEach(function (stop) {
            const rSet = {};
            stop.ids.forEach(function (sid) {
                if (stopIdToRouteIds[sid]) {
                    Object.keys(stopIdToRouteIds[sid]).forEach(function (rid) { rSet[rid] = true; });
                }
            });
            stop.routes = Object.keys(rSet).sort();
        });

        // Populate Route Select Dropdown
        routesData.forEach(function (r) {
            const id = r.route_id;
            const shortName = r.route_short_name || '';
            const longName = r.route_long_name || '';
            if (!id) return;
            const opt = document.createElement('option');
            opt.value = id;
            opt.textContent = shortName ? shortName + '（' + longName + '）' : longName || id;
            routeSelectEl.appendChild(opt);
        });

        visibleStops = allStops;
        updateDirectionDropdown('');
        updateMarkers();
        renderList(visibleStops, '');

        initMobileSheet();
        syncLayoutForScreen();
        setupEventListeners();
        startClockTimer();

    }).catch(function (err) {
        console.error(err);
        stopListEl.innerHTML = '<div class="empty-state"><p style="color:#dc2626;">データの読み込みに失敗しました: ' + escapeHtml(err.message) + '</p></div>';
    });

})();
