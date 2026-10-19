// Activity files other than GPX, turned into GPX in the browser before they're
// uploaded, so the server keeps (and works out pace, time and elevation from)
// GPX as it always has:
// - .fit: the binary files Garmin, Coros, Wahoo, Suunto and others record
// - .tcx: Garmin's older XML format
// - any of these (or .gpx) gzipped, as in a Strava "download your data" archive
//
// Convert.read(file) resolves to { text, name, fileName }: GPX text, a name for
// the track, and the file name to keep (ending .gpx, since that's what's kept).
const Convert = (() => {
  const ACCEPT = /\.(gpx|fit|tcx)(\.gz)?$/i;

  // XML-safe text.
  const x = s => String(s).replace(/[<>&"']/g, c => `&#${c.charCodeAt(0)};`);

  // GPX from segments of points { lat, lon, ele?, time? (ms) }.
  function gpx({ name, sport, time, segments }) {
    const iso = ms => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const lines = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<gpx version="1.1" creator="feets (converted)" xmlns="http://www.topografix.com/GPX/1/1">',
      `  <metadata><name>${x(name)}</name>${time ? `<time>${iso(time)}</time>` : ''}</metadata>`,
      `  <trk><name>${x(name)}</name>${sport ? `<type>${x(sport)}</type>` : ''}`,
    ];
    for (const seg of segments) {
      lines.push('    <trkseg>');
      for (const p of seg) {
        lines.push(`      <trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}">`
          + (p.ele != null ? `<ele>${p.ele.toFixed(1)}</ele>` : '')
          + (p.time != null ? `<time>${iso(p.time)}</time>` : '')
          + '</trkpt>');
      }
      lines.push('    </trkseg>');
    }
    lines.push('  </trk>', '</gpx>', '');
    return lines.join('\n');
  }

  // --- TCX ---
  // Activities (or Courses), each with Tracks of Trackpoints.
  function tcx(text, fallbackName) {
    const doc = new DOMParser().parseFromString(text.trimStart(), 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('Not valid XML');
    const first = (parent, tag) => parent.getElementsByTagName(tag)[0];
    const num = (parent, tag) => {
      const el = first(parent, tag);
      return el ? parseFloat(el.textContent) : NaN;
    };
    const segments = [];
    for (const track of doc.getElementsByTagName('Track')) {
      const seg = [];
      for (const tp of track.getElementsByTagName('Trackpoint')) {
        const lat = num(tp, 'LatitudeDegrees'), lon = num(tp, 'LongitudeDegrees');
        if (isNaN(lat) || isNaN(lon)) continue;  // indoors, or before a GPS fix
        const ele = num(tp, 'AltitudeMeters');
        const time = Date.parse((first(tp, 'Time') || {}).textContent);
        seg.push({ lat, lon, ele: isNaN(ele) ? null : ele, time: isNaN(time) ? null : time });
      }
      if (seg.length > 1) segments.push(seg);
    }
    if (!segments.length) throw new Error('No GPS points found');
    const activity = first(doc, 'Activity');
    const course = first(doc, 'Course');
    const name = (course && first(course, 'Name') && first(course, 'Name').textContent.trim())
      || (first(doc, 'Notes') && first(doc, 'Notes').textContent.trim().split('\n')[0].slice(0, 100))
      || fallbackName;
    const sport = activity && activity.getAttribute('Sport');
    return gpx({ name, sport: sport && sport !== 'Other' ? sport : null, time: segments[0][0].time, segments });
  }

  // --- FIT ---
  // Only what feets needs: records (position, height, time), the session's
  // sport, and a course's name. See the FIT SDK's Profile.xlsx for the numbers.
  const FIT_EPOCH = Date.UTC(1989, 11, 31);  // FIT times are seconds since then
  const SEMICIRCLE = 180 / 2 ** 31;          // positions are in semicircles
  const MSG = { FILE_ID: 0, SESSION: 18, RECORD: 20, COURSE: 31, EVENT: 21 };
  const SPORTS = { 1: 'running', 2: 'cycling', 5: 'swimming', 11: 'walking', 17: 'hiking' };
  const SUB_SPORTS = { '1:3': 'trail_running', '2:8': 'mountain_biking' };  // sport:sub_sport

  // Base types (the low 5 bits): their size in bytes, whether signed, and the
  // value that means "invalid". 7 is a string; 64-bit ones aren't needed.
  const BASE = {
    0: [1, false, 0xff], 1: [1, true, 0x7f], 2: [1, false, 0xff], 3: [2, true, 0x7fff],
    4: [2, false, 0xffff], 5: [4, true, 0x7fffffff], 6: [4, false, 0xffffffff], 8: [4, 'float', null],
    10: [1, false, 0], 11: [2, false, 0], 12: [4, false, 0], 13: [1, false, 0xff],
  };

  // Reads one field's value: a number, a string, or null for FIT's "invalid"
  // and for arrays and types feets doesn't use.
  function fieldValue(view, at, size, baseType, little) {
    const type = baseType & 0x1f;
    if (type === 7) {  // string: UTF-8, zero-terminated
      const bytes = new Uint8Array(view.buffer, view.byteOffset + at, size);
      const zero = bytes.indexOf(0);
      return new TextDecoder().decode(zero < 0 ? bytes : bytes.subarray(0, zero)) || null;
    }
    const base = BASE[type];
    if (!base || base[0] !== size) return null;
    let v;
    if (base[1] === 'float') {
      v = view.getFloat32(at, little);
      return Number.isFinite(v) ? v : null;
    }
    if (size === 1) v = base[1] ? view.getInt8(at) : view.getUint8(at);
    else if (size === 2) v = base[1] ? view.getInt16(at, little) : view.getUint16(at, little);
    else v = base[1] ? view.getInt32(at, little) : view.getUint32(at, little);
    return v === base[2] ? null : v;
  }

  function fit(buffer, fallbackName) {
    const view = new DataView(buffer);
    if (buffer.byteLength < 14) throw new Error('Not a FIT file');
    const headerSize = view.getUint8(0);
    const tag = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));
    if (tag !== '.FIT') throw new Error('Not a FIT file');
    const end = Math.min(buffer.byteLength, headerSize + view.getUint32(4, true));

    const defs = {};  // local message number -> { global, little, fields: [{ num, size, type }], devSize }
    const records = [];
    let lastTime = null, sport = null, subSport = null, name = null, created = null;
    let at = headerSize;
    while (at < end) {
      const header = view.getUint8(at++);
      let local, compressedTime = null;
      if (header & 0x80) {  // compressed timestamp header: a data message
        local = (header >> 5) & 0x03;
        compressedTime = header & 0x1f;
      } else {
        local = header & 0x0f;
        if (header & 0x40) {  // definition message
          const little = view.getUint8(at + 1) === 0;
          const global = view.getUint16(at + 2, little);
          const count = view.getUint8(at + 4);
          at += 5;
          const fields = [];
          for (let i = 0; i < count; i++, at += 3) {
            fields.push({ num: view.getUint8(at), size: view.getUint8(at + 1), type: view.getUint8(at + 2) });
          }
          let devSize = 0;
          if (header & 0x20) {  // developer fields: skipped
            const devCount = view.getUint8(at++);
            for (let i = 0; i < devCount; i++, at += 3) devSize += view.getUint8(at + 1);
          }
          defs[local] = { global, little, fields, devSize };
          continue;
        }
      }
      const def = defs[local];
      if (!def) throw new Error('This FIT file is damaged');
      const values = {};
      for (const f of def.fields) {
        if (at + f.size > buffer.byteLength) throw new Error('This FIT file is cut short');
        values[f.num] = fieldValue(view, at, f.size, f.type, def.little);
        at += f.size;
      }
      at += def.devSize;

      // Times: field 253 on any message; a compressed header gives the low 5 bits.
      if (values[253] != null) lastTime = values[253];
      else if (compressedTime !== null && lastTime !== null) {
        lastTime = (lastTime & ~0x1f) + compressedTime + (compressedTime < (lastTime & 0x1f) ? 0x20 : 0);
        values[253] = lastTime;
      }

      if (def.global === MSG.RECORD) {
        if (values[0] == null || values[1] == null) continue;  // no GPS fix
        // enhanced_altitude (78) or altitude (2): scale 5, offset 500.
        const raw = values[78] != null ? values[78] : values[2];
        records.push({
          lat: values[0] * SEMICIRCLE,
          lon: values[1] * SEMICIRCLE,
          ele: raw != null ? raw / 5 - 500 : null,
          time: values[253] != null ? FIT_EPOCH + values[253] * 1000 : null,
        });
      } else if (def.global === MSG.SESSION && sport === null) {
        sport = values[5];
        subSport = values[6];
      } else if (def.global === MSG.COURSE && values[5]) {
        name = values[5];
      } else if (def.global === MSG.FILE_ID && values[4] != null) {
        created = FIT_EPOCH + values[4] * 1000;
      }
    }

    // Long pauses (the watch stopped) start a new segment, as GPX tracks do.
    const segments = [];
    let seg = [];
    for (const p of records) {
      const prev = seg[seg.length - 1];
      if (prev && p.time != null && prev.time != null && p.time - prev.time > 10 * 60 * 1000) {
        if (seg.length > 1) segments.push(seg);
        seg = [];
      }
      seg.push(p);
    }
    if (seg.length > 1) segments.push(seg);
    if (!segments.length) throw new Error('No GPS points found');
    return gpx({
      name: name || fallbackName,
      sport: SUB_SPORTS[`${sport}:${subSport}`] || SPORTS[sport] || null,
      time: segments[0][0].time || created,
      segments,
    });
  }

  async function gunzip(file) {
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser can\'t open .gz files; unzip it first');
    return new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  }

  async function read(file) {
    const zipped = /\.gz$/i.test(file.name);
    const plain = file.name.replace(/\.gz$/i, '');
    const base = plain.replace(/\.(gpx|fit|tcx)$/i, '');
    const bytes = zipped ? await gunzip(file) : await file.arrayBuffer();
    let text;
    if (/\.fit$/i.test(plain)) text = fit(bytes, base);
    else if (/\.tcx$/i.test(plain)) text = tcx(new TextDecoder().decode(bytes), base);
    else text = new TextDecoder().decode(bytes);
    return { text, name: base, fileName: `${base}.gpx` };
  }

  return { ACCEPT, read, fit, tcx, gpx };
})();
