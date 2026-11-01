// Control bar logic. Receives state from the main process and renders it.
const $ = (id) => document.getElementById(id);
const tabsEl = $('tabs');
let builtTabs = false;

function buildTabs(services) {
  tabsEl.innerHTML = '';
  services.forEach((svc, i) => {
    const btn = document.createElement('button');
    btn.className = 'tab';
    btn.dataset.id = svc.id;
    btn.setAttribute('role', 'tab');
    btn.style.setProperty('--svc', svc.color);
    btn.title = `${svc.name} (Ctrl+${i + 1})`;

    const dot = document.createElement('span');
    dot.className = 'dot';
    const name = document.createElement('span');
    name.textContent = svc.name;
    const eq = document.createElement('span');
    eq.className = 'eq';
    eq.innerHTML = '<i></i><i></i><i></i>';
    const key = document.createElement('span');
    key.className = 'key';
    key.textContent = `^${i + 1}`;

    btn.append(dot, name, eq, key);
    btn.addEventListener('click', () => window.unisono.selectTab(svc.id));
    tabsEl.appendChild(btn);
  });
  builtTabs = true;
}

function render(s) {
  if (!builtTabs) buildTabs(s.services);

  for (const btn of tabsEl.children) {
    const svc = s.services.find((x) => x.id === btn.dataset.id);
    btn.setAttribute('aria-selected', String(btn.dataset.id === s.activeTab));
    btn.classList.toggle('playing', Boolean(svc && svc.playing));
  }

  const np = s.nowPlaying;
  const nowEl = $('now');
  const svc = s.services.find((x) => x.id === s.nowPlayingId);
  const hasTrack = Boolean(np && np.title);

  nowEl.classList.toggle('idle', !hasTrack);
  $('title').textContent = hasTrack ? np.title : 'Nothing playing';
  $('artist').textContent = hasTrack ? np.artist : '';
  $('badge').textContent = hasTrack && svc ? svc.name : '';
  if (svc) $('badge').style.setProperty('--svc', svc.color);

  // Only accept https artwork URLs.
  const art = hasTrack && /^https:\/\//.test(np.artwork) ? np.artwork : '';
  $('art').style.backgroundImage = art ? `url("${art.replace(/"/g, '%22')}")` : '';

  const playing = Boolean(np && np.playing);
  $('icon-play').hidden = playing;
  $('icon-pause').hidden = !playing;
}

$('toggle').addEventListener('click', () => window.unisono.control('toggle'));
$('next').addEventListener('click', () => window.unisono.control('next'));
$('prev').addEventListener('click', () => window.unisono.control('previous'));
$('back').addEventListener('click', () => window.unisono.back());
$('reload').addEventListener('click', () => window.unisono.reload());

window.unisono.onState(render);
window.unisono.ready();
