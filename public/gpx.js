// Minimal GPX parser: turns GPX text into { name, segments: [[[lat, lon], ...]], waypoints, distance }.
const GPX = (() => {
  function points(parent, tag) {
    return Array.from(parent.getElementsByTagName(tag)).map(pt => [
      parseFloat(pt.getAttribute('lat')),
      parseFloat(pt.getAttribute('lon')),
    ]).filter(([lat, lon]) => !isNaN(lat) && !isNaN(lon));
  }

  function textOf(parent, tag) {
    const el = parent.getElementsByTagName(tag)[0];
    return el ? el.textContent.trim() : '';
  }

  // Haversine distance in metres.
  function distance([lat1, lon1], [lat2, lon2]) {
    const R = 6371000;
    const toRad = d => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  function parse(text, fallbackName) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) {
      throw new Error('Not valid XML');
    }

    const segments = [];
    for (const seg of doc.getElementsByTagName('trkseg')) segments.push(points(seg, 'trkpt'));
    for (const rte of doc.getElementsByTagName('rte')) segments.push(points(rte, 'rtept'));

    const waypoints = Array.from(doc.getElementsByTagName('wpt')).map(w => ({
      latlng: [parseFloat(w.getAttribute('lat')), parseFloat(w.getAttribute('lon'))],
      name: textOf(w, 'name'),
    }));

    const nonEmpty = segments.filter(s => s.length > 1);
    if (!nonEmpty.length && !waypoints.length) {
      throw new Error('No tracks, routes or waypoints found');
    }

    let total = 0;
    for (const seg of nonEmpty) {
      for (let i = 1; i < seg.length; i++) total += distance(seg[i - 1], seg[i]);
    }

    const trk = doc.getElementsByTagName('trk')[0];
    const meta = doc.getElementsByTagName('metadata')[0];
    const name = (trk && textOf(trk, 'name')) || (meta && textOf(meta, 'name')) || fallbackName;
    const timeEl = doc.getElementsByTagName('time')[0];

    return {
      name,
      // Raw activity type, e.g. "running"; the server turns it into a label like "Run".
      sport: (trk && textOf(trk, 'type')) || null,
      time: timeEl ? timeEl.textContent.trim() : null,
      segments: nonEmpty,
      waypoints,
      distance: total,
    };
  }

  return { parse };
})();
