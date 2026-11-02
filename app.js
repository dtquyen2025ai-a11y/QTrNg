(() => {
  'use strict';

  // ---------- Lưu trữ ----------
  const KEY = 'chua-tam-an-v1';
  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const defaults = () => ({
    merit: 0, mo: 0, mala: 0, huong: 0, den: 0,
    days: {},            // { 'YYYY-MM-DD': số công đức trong ngày }
    incense: null,       // { start, end, count }
    xam: null,           // { date, idx }
    wishes: [],          // [{ text, t }]
    sound: true,
  });
  let S;
  try { S = Object.assign(defaults(), JSON.parse(localStorage.getItem(KEY) || '{}')); }
  catch { S = defaults(); }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {} };

  const $ = (id) => document.getElementById(id);
  const fmt = (n) => n.toLocaleString('vi-VN');

  // ---------- Âm thanh (WebAudio, không cần file) ----------
  let ctx;
  const audio = () => (ctx ||= new (window.AudioContext || window.webkitAudioContext)());
  function woodBlock() {
    if (!S.sound) return;
    const a = audio(), t = a.currentTime;
    const o = a.createOscillator(), g = a.createGain(), f = a.createBiquadFilter();
    o.type = 'sine';
    o.frequency.setValueAtTime(820, t);
    o.frequency.exponentialRampToValueAtTime(420, t + 0.08);
    f.type = 'bandpass'; f.frequency.value = 700; f.Q.value = 3;
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    o.connect(f).connect(g).connect(a.destination);
    o.start(t); o.stop(t + 0.2);
    // tiếng "cốc" ngắn
    const n = a.createBufferSource(), buf = a.createBuffer(1, a.sampleRate * 0.02, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    n.buffer = buf;
    const ng = a.createGain(); ng.gain.value = 0.25;
    n.connect(f); n.connect(ng).connect(a.destination); n.start(t);
  }
  function bell() {
    if (!S.sound) return;
    const a = audio(), t = a.currentTime;
    [[196, 1], [392, .5], [523, .3], [784, .2], [1046, .1]].forEach(([fr, v]) => {
      const o = a.createOscillator(), g = a.createGain();
      o.type = 'sine'; o.frequency.value = fr;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(v * 0.35, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 6);
      o.connect(g).connect(a.destination); o.start(t); o.stop(t + 6.1);
    });
  }

  // ---------- Công đức ----------
  function addMerit(n) {
    S.merit += n;
    const k = today();
    S.days[k] = (S.days[k] || 0) + n;
    const pill = $('meritTotal');
    pill.textContent = fmt(S.merit);
    pill.parentElement.classList.remove('bump'); void pill.offsetWidth; pill.parentElement.classList.add('bump');
    save();
  }
  function markVisit() {
    const k = today();
    if (!(k in S.days)) { S.days[k] = 0; save(); }
  }

  const RANKS = [
    [0, 'Phật tử sơ cơ'], [108, 'Thiện nam tín nữ'], [500, 'Người gieo duyên'],
    [1080, 'Hành giả tinh tấn'], [3000, 'Tâm sáng như trăng'], [10800, 'Hộ pháp thiện tâm'],
    [30000, 'Đạo tâm kiên cố'], [108000, 'Bồ đề tâm viên mãn'],
  ];
  function rankOf(m) {
    let i = 0;
    while (i + 1 < RANKS.length && m >= RANKS[i + 1][0]) i++;
    return i;
  }

  function streak() {
    let n = 0; const d = new Date();
    if (!(today() in S.days)) d.setDate(d.getDate() - 1);
    for (;;) {
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (!(k in S.days)) break;
      n++; d.setDate(d.getDate() - 1);
    }
    return n;
  }

  // ---------- Toast ----------
  let toastT;
  function toast(msg) {
    const el = $('toast'); el.textContent = msg; el.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 2400);
  }

  // ---------- Tabs ----------
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach((x) => x.setAttribute('aria-selected', x === b));
    document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + b.dataset.tab));
    if (b.dataset.tab === 'so') renderLedger();
  }));

  // ---------- Gõ mõ + chuỗi 108 ----------
  const ring = $('malaRing');
  const beads = [];
  for (let i = 0; i < 108; i++) {
    const a = (i / 108) * Math.PI * 2 - Math.PI / 2;
    const el = document.createElement('i');
    el.className = 'bead' + (i === 0 ? ' big' : '');
    el.style.left = 50 + 46 * Math.cos(a) + '%';
    el.style.top = 50 + 46 * Math.sin(a) + '%';
    ring.appendChild(el); beads.push(el);
  }
  function renderMala() {
    const c = S.mo % 108;
    beads.forEach((b, i) => b.classList.toggle('on', i > 0 && i <= c));
    $('malaCount').textContent = c;
    $('malaRounds').textContent = S.mala + 1;
  }

  const moBtn = $('moBtn'), dui = $('dui'), layer = $('floatLayer');
  function strike() {
    woodBlock();
    moBtn.classList.add('hit'); dui.classList.add('hit');
    setTimeout(() => { moBtn.classList.remove('hit'); dui.classList.remove('hit'); }, 90);
    if (navigator.vibrate) navigator.vibrate(8);

    S.mo++;
    let gain = 1;
    if (S.mo % 108 === 0) {
      S.mala++; gain += 108;
      setTimeout(bell, 150);
      toast(`Viên mãn chuỗi 108 thứ ${S.mala} · +108 công đức`);
    }
    addMerit(gain);

    const f = document.createElement('div');
    f.className = 'float';
    f.textContent = S.mo % 7 === 0 ? $('chant').value : '+1 công đức';
    f.style.marginLeft = (Math.random() * 80 - 40) + 'px';
    layer.appendChild(f);
    setTimeout(() => f.remove(), 1200);
    renderMala();
  }
  moBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); strike(); });
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || /TEXTAREA|SELECT|INPUT/.test(document.activeElement.tagName)) return;
    if (!$('tab-mo').classList.contains('active')) return;
    e.preventDefault(); if (!e.repeat) strike();
  });

  let autoT = null;
  $('autoBtn').addEventListener('click', (e) => {
    if (autoT) { clearInterval(autoT); autoT = null; e.target.textContent = '▶ Tự gõ'; e.target.classList.remove('on'); }
    else { autoT = setInterval(strike, 900); e.target.textContent = '⏸ Dừng'; e.target.classList.add('on'); }
  });
  $('bellBtn').addEventListener('click', () => { bell(); addMerit(1); toast('Chuông vang ba cõi, tâm lắng an'); });
  const soundBtn = $('soundBtn');
  const renderSound = () => { soundBtn.textContent = S.sound ? '🔊 Âm thanh' : '🔇 Tắt tiếng'; };
  soundBtn.addEventListener('click', () => { S.sound = !S.sound; save(); renderSound(); });

  // ---------- Thắp hương ----------
  const BURN_MS = 15 * 60 * 1000; // 15 phút
  const sticksEl = $('sticks');
  let smokeBuilt = 0;
  function renderIncense() {
    const inc = S.incense, now = Date.now();
    const status = $('incenseStatus');
    const burning = inc && now < inc.end;
    document.querySelectorAll('[data-sticks]').forEach((b) => (b.disabled = !!burning));
    if (!inc) { sticksEl.innerHTML = ''; smokeBuilt = 0; status.textContent = 'Chưa thắp hương.'; return; }
    const p = Math.min(1, (now - inc.start) / (inc.end - inc.start));
    if (smokeBuilt !== inc.count + (burning ? 0 : 100)) {
      sticksEl.innerHTML = '';
      for (let i = 0; i < inc.count; i++) {
        const s = document.createElement('div'); s.className = 'stick';
        s.innerHTML = '<div class="body"></div><div class="handle"></div>' +
          (burning ? '<div class="ember"></div><div class="smoke"></div><div class="smoke" style="animation-delay:1s"></div><div class="smoke" style="animation-delay:2s"></div>' : '');
        sticksEl.appendChild(s);
      }
      smokeBuilt = inc.count + (burning ? 0 : 100);
    }
    const h = Math.max(0, 78 * (1 - p));
    sticksEl.querySelectorAll('.stick').forEach((s) => {
      s.querySelector('.body').style.height = h + 'px';
      const top = 100 - 22 - h - 4;
      s.querySelectorAll('.ember').forEach((e) => (e.style.top = top + 'px'));
      s.querySelectorAll('.smoke').forEach((e) => (e.style.top = top - 8 + 'px'));
    });
    if (burning) {
      const left = Math.ceil((inc.end - now) / 60000);
      status.textContent = `${inc.count} nén hương đang cháy · còn khoảng ${left} phút`;
    } else {
      status.textContent = 'Hương đã tàn. Mời thắp nén mới.';
    }
  }
  document.querySelectorAll('[data-sticks]').forEach((b) => b.addEventListener('click', () => {
    const n = +b.dataset.sticks, now = Date.now();
    S.incense = { start: now, end: now + BURN_MS, count: n };
    S.huong += n; smokeBuilt = 0;
    const gain = { 1: 10, 3: 36, 5: 66 }[n];
    addMerit(gain); bell();
    const pr = $('prayer').value.trim();
    toast(pr ? 'Lời khấn đã được dâng lên · +' + gain + ' công đức' : `Dâng ${n} nén hương · +${gain} công đức`);
    $('prayer').value = '';
    renderIncense();
  }));
  setInterval(renderIncense, 5000);

  // ---------- Xin xăm (nội dung tự soạn) ----------
  const XAM = [
    ['Thượng thượng', 'Mây tan trăng hiện giữa trời,\nThuyền xuôi gió thuận tới nơi bến lành.', 'Việc đang mong cầu thuận lợi. Giữ lòng ngay thẳng, chuyện tốt sẽ đến đúng lúc. Hợp khởi sự, gặp gỡ, cầu tài.'],
    ['Thượng', 'Hạt gieo đúng đất đúng mùa,\nChăm tay vun tưới, được mùa về sau.', 'Thành quả đến từ sự bền bỉ. Đừng nóng vội; việc học, việc làm cứ đều đặn sẽ có kết quả.'],
    ['Thượng', 'Đèn ai thắp giữa đêm sâu,\nSoi đường người lạ, sáng sau lối mình.', 'Giúp người là giúp mình. Quý nhân xuất hiện qua chính những mối quan hệ bạn vun đắp.'],
    ['Trung bình', 'Sông dài còn khúc quanh co,\nĐò ngang chậm chuyến, chớ lo lỡ đò.', 'Có trì hoãn nhỏ nhưng không hỏng việc. Chuẩn bị kỹ, kiên nhẫn chờ thời điểm.'],
    ['Trung bình', 'Lá rơi cho lộc đâm chồi,\nCũ đi mới tới, đổi dời là duyên.', 'Một thay đổi sắp đến. Buông bớt điều không còn hợp để đón cái mới.'],
    ['Trung bình', 'Gió đông thổi lệch cánh diều,\nNắm dây cho chắc, chớ chiều theo mây.', 'Dễ bị người khác tác động. Giữ chính kiến, cân nhắc trước khi hứa hẹn hay chi tiền.'],
    ['Thượng', 'Giếng trong múc mãi không vơi,\nLòng thành giữ vững, phúc đời dài lâu.', 'Gia đạo yên ổn. Sức khỏe tốt nếu điều độ. Nên dành thời gian cho người thân.'],
    ['Hạ', 'Mưa giông chợt đến ngang chiều,\nTrú yên một chốc, nắng nhiều mai sau.', 'Gặp trắc trở ngắn hạn. Tránh tranh cãi, tránh quyết định lớn khi đang nóng giận. Qua cơn sẽ ổn.'],
    ['Trung bình', 'Núi cao từng bước mà lên,\nĐừng nhìn đỉnh vội, chân bền tới nơi.', 'Mục tiêu lớn cần chia nhỏ. Làm tốt việc hôm nay là đủ.'],
    ['Thượng thượng', 'Sen vươn khỏi bùn nở hoa,\nTâm trong như nước, an hòa mọi nơi.', 'Tâm an thì việc an. Thời điểm tốt để sửa mình, học điều mới, bắt đầu thói quen lành.'],
    ['Hạ', 'Thuyền đầy chớ vội ra khơi,\nBớt đi đôi món, nhẹ người dễ đi.', 'Đang ôm đồm quá sức. Bớt tham, sắp xếp lại ưu tiên, chú ý tiền bạc và giấc ngủ.'],
    ['Thượng', 'Chim về tổ cũ chiều hôm,\nNgười xa trở lại, tin thơm báo về.', 'Tin vui từ người quen cũ hoặc từ phương xa. Hàn gắn được mối quan hệ từng rạn nứt.'],
    ['Trung bình', 'Trăng khuyết rồi lại trăng tròn,\nĐủ đầy hay thiếu vẫn còn có nhau.', 'Không phải lúc nào cũng trọn vẹn. Trân trọng những gì đang có, mọi việc sẽ dần tròn.'],
    ['Thượng', 'Chuông chùa vọng sáng tinh sương,\nTâm khai trí sáng, con đường rõ thông.', 'Đầu óc minh mẫn, hợp thi cử, ký kết, lập kế hoạch. Nên bắt đầu việc quan trọng vào buổi sáng.'],
  ];
  function showXam(idx) {
    const [rank, poem, meaning] = XAM[idx];
    $('xamNo').textContent = `QUẺ SỐ ${idx + 1}`;
    $('xamRank').textContent = rank;
    $('xamPoem').textContent = poem;
    $('xamMeaning').textContent = meaning;
    $('xamCard').hidden = false;
  }
  $('tubeBtn').addEventListener('click', () => {
    const tube = $('tubeBtn');
    if (S.xam && S.xam.date === today()) {
      showXam(S.xam.idx);
      toast('Hôm nay bạn đã xin quẻ. Mai quay lại nhé 🙏');
      return;
    }
    tube.classList.remove('shake'); void tube.offsetWidth; tube.classList.add('shake');
    for (let i = 0; i < 6; i++) setTimeout(woodBlock, i * 120);
    setTimeout(() => {
      tube.classList.remove('shake');
      const idx = Math.floor(Math.random() * XAM.length);
      S.xam = { date: today(), idx }; addMerit(5); showXam(idx);
    }, 1000);
  });
  if (S.xam && S.xam.date === today()) showXam(S.xam.idx);

  // ---------- Hoa đăng ----------
  const lake = $('lake');
  function launchLantern(text, delay = 0) {
    const el = document.createElement('div');
    el.className = 'lantern';
    el.innerHTML = '🪷<span></span>';
    el.querySelector('span').textContent = text;
    const dur = 18 + Math.random() * 10;
    el.style.top = 40 + Math.random() * 110 + 'px';
    el.style.left = '0';
    el.style.setProperty('--w', lake.clientWidth + 40 + 'px');
    el.style.animationDuration = dur + 's';
    el.style.animationDelay = delay + 's';
    lake.appendChild(el);
    setTimeout(() => el.remove(), (dur + delay) * 1000);
  }
  function renderWishes() {
    const ul = $('wishList'); ul.innerHTML = '';
    S.wishes.slice(-10).reverse().forEach((w) => {
      const li = document.createElement('li');
      const t = document.createElement('time');
      t.textContent = new Date(w.t).toLocaleDateString('vi-VN');
      const s = document.createElement('span'); s.textContent = w.text;
      li.append(t, s); ul.appendChild(li);
    });
  }
  $('releaseBtn').addEventListener('click', () => {
    const text = $('wish').value.trim();
    if (!text) { toast('Hãy viết một lời nguyện'); return; }
    S.wishes.push({ text, t: Date.now() });
    if (S.wishes.length > 200) S.wishes.shift();
    S.den++; addMerit(20);
    $('wish').value = '';
    launchLantern(text); renderWishes();
    toast('Hoa đăng đã trôi theo dòng nước · +20 công đức');
  });
  // đèn nền trôi nhẹ để hồ không trống
  const ambient = ['Bình an', 'Sức khỏe', 'Hạnh phúc', 'An lạc', 'Thuận hòa'];
  ambient.forEach((t, i) => launchLantern(t, i * 4));
  setInterval(() => {
    const pool = S.wishes.length ? S.wishes.map((w) => w.text) : ambient;
    if (document.visibilityState === 'visible') launchLantern(pool[Math.floor(Math.random() * pool.length)]);
  }, 5000);

  // ---------- Sổ công đức ----------
  function renderLedger() {
    const r = rankOf(S.merit);
    $('rankTitle').textContent = RANKS[r][1];
    if (r + 1 < RANKS.length) {
      const [lo] = RANKS[r], [hi, name] = RANKS[r + 1];
      $('rankBar').style.width = ((S.merit - lo) / (hi - lo)) * 100 + '%';
      $('rankNext').textContent = `Còn ${fmt(hi - S.merit)} công đức để đạt "${name}"`;
    } else {
      $('rankBar').style.width = '100%';
      $('rankNext').textContent = 'Đã đạt bậc cao nhất. A Di Đà Phật!';
    }
    $('sMo').textContent = fmt(S.mo);
    $('sMala').textContent = fmt(S.mala);
    $('sHuong').textContent = fmt(S.huong);
    $('sDen').textContent = fmt(S.den);
    $('sDays').textContent = fmt(Object.keys(S.days).length);
    $('sStreak').textContent = fmt(streak());

    const week = $('week'); week.innerHTML = '';
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      days.push({ k, v: S.days[k] || 0, lbl: i === 0 ? 'Nay' : ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][d.getDay()] });
    }
    const max = Math.max(1, ...days.map((d) => d.v));
    days.forEach((d) => {
      const b = document.createElement('div');
      b.className = 'bar' + (d.lbl === 'Nay' ? ' today' : '');
      b.title = `${d.k}: ${d.v} công đức`;
      b.innerHTML = `<small>${d.v || ''}</small><i style="height:${(d.v / max) * 80}%"></i><span>${d.lbl}</span>`;
      week.appendChild(b);
    });
  }
  $('resetBtn').addEventListener('click', () => {
    if (!confirm('Xóa toàn bộ công đức và lịch sử trên máy này?')) return;
    S = defaults(); save(); location.reload();
  });

  // ---------- Cảnh ngày / đêm + lời chào ----------
  function sceneByHour() {
    const h = new Date().getHours();
    const night = h < 5 || h >= 19, dusk = (h >= 17 && h < 19) || (h >= 5 && h < 7);
    const [top, bot] = night ? ['#0f1a3a', '#2a2a55'] : dusk ? ['#f2a65a', '#f8d9a8'] : ['#9fd0f0', '#fbeed6'];
    $('skyTop').setAttribute('stop-color', top);
    $('skyBot').setAttribute('stop-color', bot);
    const sm = $('sunMoon');
    sm.setAttribute('fill', night ? '#f4efd2' : '#f6b84b');
    sm.setAttribute('cy', night ? 40 : dusk ? 90 : 45);
    const stars = $('stars');
    if (night && !stars.childElementCount) {
      for (let i = 0; i < 30; i++) {
        const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        c.setAttribute('cx', Math.random() * 400); c.setAttribute('cy', Math.random() * 100);
        c.setAttribute('r', Math.random() * 1.2 + .3); c.setAttribute('fill', '#fff');
        stars.appendChild(c);
      }
    }
    stars.setAttribute('opacity', night ? 1 : 0);
    $('greeting').textContent =
      h < 11 ? 'Buổi sáng an lành · Nam Mô A Di Đà Phật' :
      h < 14 ? 'Buổi trưa thanh tịnh · Nam Mô A Di Đà Phật' :
      h < 18 ? 'Buổi chiều an yên · Nam Mô A Di Đà Phật' :
               'Buổi tối bình an · Nam Mô A Di Đà Phật';
  }

  // ---------- Khởi động ----------
  markVisit();
  $('meritTotal').textContent = fmt(S.merit);
  renderMala(); renderSound(); renderIncense(); renderWishes(); sceneByHour();
  setInterval(sceneByHour, 60000);
})();
