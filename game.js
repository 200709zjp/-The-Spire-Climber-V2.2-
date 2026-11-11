'use strict';
/* 《这个怪楼有点高》骨架 v0.2 —— 之字形楼梯文法 + 程序化像素美术（可被 AI 贴图替换）
   逻辑分辨率 720x405，16:9 全横屏；固定步长 1/60。 */

const CFG = {
  W: 720, H: 405,
  G: 1500,
  jumpV: -560,      // 规格 -520 跃高 90px 够不到 96 层高，修正为 -560（跃高 104）
  djV: -460,
  wallJumpX: 380, wallJumpY: -460,
  coyote: 0.10, buffer: 0.12, jumpCut: 0.5,
  runMax: 190, accG: 1400, accA: 1100,
  wallSlideMax: 90, climbV: 70, grabToClimb: 0.25,
  slamV: 620, shockR: 48,
  hitstop: 0.07, shakePx: 4, shakeT: 0.12,
  FH: 96, platT: 16, wallT: 24, stepH: 24, stepW: 60,
  camAnchor: 0.68,
  collapseDelay: 8, collapseSpeed: 0.23 * 96, warnAhead: 80,   // 横屏纵向预读更短，基速降到 15.6 层/min
  comboWin: 1.2, comboCap: 2.0,
  melee: { dmg: 12, cd: 0.28, range: 150, arcW: 64, arcH: 44 },
  ranged: { dmg: 8, cd: 0.42, speed: 420 },
  iframes: 0.8,
  dodge: { speed: 380, dur: 0.18, iframe: 0.28, cd: 0.9 },
  hpMax: 100,
  slamDmg: 18,
  healOrb: 30,
  bossEvery: 50,
};
/* 可控难度：只影响敌人数量/血量/伤害、陷阱频率与崩落速度，不改操作手感与核心规则 */
const DIFFICULTY = {
  easy:   { id: 'easy',   name: '轻松', desc: '敌人更少更脆 · 崩落更慢', enemy: 0.72, trap: 0.70, hp: 0.82, dmg: 0.84, collapse: 0.82 },
  normal: { id: 'normal', name: '标准', desc: '当前基准 · 有压力但不刁难', enemy: 1.00, trap: 1.00, hp: 1.00, dmg: 1.00, collapse: 1.00 },
  hard:   { id: 'hard',   name: '困难', desc: '更多敌人与陷阱 · 崩落更快', enemy: 1.34, trap: 1.34, hp: 1.24, dmg: 1.16, collapse: 1.16 },
  hell:   { id: 'hell',   name: '超级困难', desc: '满编敌人 · 厚血重击 · 崩落紧追', enemy: 1.62, trap: 1.60, hp: 1.50, dmg: 1.34, collapse: 1.32 },
};
function difficultyNow() { return DIFFICULTY[S.difficulty] || DIFFICULTY.normal; }
function setDifficulty(id) {
  if (!DIFFICULTY[id]) return S.difficulty;
  S.difficulty = id;
  S.meta.difficulty = id;
  saveMeta();
  if (S.hall) toast('难度：' + DIFFICULTY[id].name + ' · ' + DIFFICULTY[id].desc, (id === 'hard' || id === 'hell') ? PAL.red : PAL.gold);
  return S.difficulty;
}
/* 经验曲线与成长（数值总表 v1）：升级自动 +6% 攻击 / +4% 跑速 / +5 生命上限，封顶 Lv10 */
const LV_XP = [40, 70, 105, 145, 190, 240, 295, 355, 420, 490];
const GROW = { atk: 0.06, spd: 0.04, hp: 5, cap: 10 };
/* 奖励表：kind -> [xp, 金币]（精选 7 种高互动小怪 + Boss） */
const REWARD = { wisp: [10, 2], crawl: [12, 3], moth: [16, 4], bomber: [18, 4], raider: [20, 5], grenadier: [18, 4], sniper: [22, 5], turret: [6, 2], boss: [120, 30] };
function depthMul(f) { return Math.min(1.6, 1 + 0.15 * Math.floor(Math.max(0, f) / 20)); }
/* 武器表（数值总表 v1）：伤害均 ×攻击倍率×连击倍率 */
const WEAP = {
  knife:    { slot: 'melee',  name: '短刀', dmg: 12, cd: 0.28, arcW: 86, arcH: 46, tag: '快斩 · 反手握持', note: '收招最快，适合贴身连段' },
  long:     { slot: 'melee',  name: '长刀', dmg: 22, cd: 0.48, anim: 0.38, arcW: 104, arcH: 56, tag: '长程横扫', note: '攻击距离更远，单发更重' },
  hammer:   { slot: 'melee',  name: '铁锤', dmg: 26, cd: 0.50, arcW: 76, arcH: 50, splash: 52, tag: '震地 · 砸落', note: '命中带震地，扫台下魔物', ach: 'hammer' },
  crossbow: { slot: 'ranged', name: '连弩', dmg: 8,  cd: 0.22, anim: 0.16, speed: 420, tag: '连续射击', note: '射速最高，长按可连射' },
  orb:      { slot: 'ranged', name: '法球', dmg: 14, cd: 0.40, anim: 0.26, speed: 300, grav: 600, explode: 40, tag: '抛射 · 爆炸', note: '越过平台打高处，落点爆炸', ach: 'orb' },
  ember:    { slot: 'melee',  name: '烬铁巨剑', dmg: 34, cd: 0.62, anim: 0.44, arcW: 120, arcH: 64, splash: 40, tag: '重扫 · 爆裂', note: '黑市孤品，双手蓄力斩出极巨扇形余烬刀罡与熔岩地裂', shopOnly: true },
};
/* 怪物体型判定盒（半宽/半高）：BOSS 不再只有胸口一条能被打中 */
const M_HIT = {
  wisp: { x: 12, y: 10 }, crawl: { x: 14, y: 9 }, moth: { x: 13, y: 11 }, bomber: { x: 12, y: 11 },
  raider: { x: 12, y: 15 }, grenadier: { x: 12, y: 13 }, sniper: { x: 13, y: 13 }, turret: { x: 9, y: 9 },
  dummy: { x: 18, y: 24 }, boss: { x: 50, y: 52 },
};
const MON_META = {
  wisp:      { name: '浮眼', hp: 20, dmg: 15, tag: '飞扑' },
  crawl:     { name: '刺爬', hp: 30, dmg: 18, tag: '猛扑' },
  moth:      { name: '符蛾', hp: 28, dmg: 14, tag: '弹幕' },
  bomber:    { name: '炎蝠', hp: 22, dmg: 24, tag: '自爆' },
  raider:    { name: '鬼侍', hp: 38, dmg: 16, tag: '突刺' },
  grenadier: { name: '壶灵', hp: 34, dmg: 15, tag: '抛爆' },
  sniper:    { name: '魔瞳', hp: 32, dmg: 14, tag: '锁定' },
  turret:    { name: '弩机', hp: 30, dmg: 12, tag: '机关' },
};
/* 陷阱表（数值总表 v1 · 三·补）：dmg 对玩家；mon=是否也伤小怪 */
const TRAP_META = {
  spike:     { name: '地刺', dmg: 14, mon: true,  tag: '周期' },
  belt:      { name: '传送带', dmg: 0, mon: false, tag: '推移' },
  turret:    { name: '弩机', dmg: 12, mon: false, tag: '可毁' },
  ice:       { name: '冰面', dmg: 0, mon: false, tag: '打滑' },
  rock:      { name: '落石', dmg: 20, mon: true,  tag: '触发' },
  flame:     { name: '火口', dmg: 16, mon: true,  tag: '喷发' },
  saw:       { name: '回旋锯', dmg: 18, mon: true, tag: '巡游' },
  spikewall: { name: '刺墙', dmg: 12, mon: false, tag: '禁抓' },
};
const TRAP_KINDS = ['spike', 'belt', 'turret', 'ice', 'rock', 'flame', 'saw', 'spikewall'];
const TRAP_DEBUT = { 3: 'spike', 5: 'belt', 7: 'turret', 9: 'ice', 12: 'rock', 13: 'flame', 14: 'saw', 17: 'spikewall' };
const TRAP_UNLOCK = { spike: 3, belt: 5, turret: 7, ice: 9, rock: 12, flame: 13, saw: 14, spikewall: 17 };
/* 四相轮值 + 75F 楼心；楼心是魔塔本体，不属于四相 */
const BOSS_ORDER = ['colossus', 'shura', 'lantern', 'ocular'];
const TRAIN_BOSS_ORDER = BOSS_ORDER.concat(['heart']);
const BOSS_META = {
  colossus: { name: '玄岳', title: '镇塔巨像 · 玄岳', tag: '裂地波 / 钟乳落石', hp: 320, dmg: 22, time: 28, hit: { x: 42, y: 46 }, color: '#ebb34b', c: '#ebb34b' },
  shura:    { name: '修罗', title: '赤铠鬼将 · 修罗', tag: '贯堂居合 / 炼狱火柱', hp: 370, dmg: 20, time: 30, hit: { x: 20, y: 26 }, color: '#e03c31', c: '#e03c31' },
  lantern:  { name: '幽烛', title: '冥灯司命 · 幽烛', tag: '移形灯阵 / 爆炎魂灯', hp: 400, dmg: 18, time: 30, hit: { x: 24, y: 28 }, color: '#b07cf0', c: '#b07cf0' },
  ocular:   { name: '天枢', title: '千机魔眼 · 天枢', tag: '裁决光束 / 齿轮轰炸', hp: 440, dmg: 20, time: 32, hit: { x: 28, y: 28 }, color: '#48c9b0', c: '#48c9b0' },
  heart:    { name: '楼心', title: '魔塔本体 · 楼心', tag: '四相残影 / 读你 / 耐心见底', hp: 720, dmg: 24, time: 45, hit: { x: 56, y: 56 }, color: '#d94a7a', c: '#d94a7a' },
};
function isBossFloor(i) { return i > 0 && i % CFG.bossEvery === 0; }
function isBossArenaUpper(i) { return i > 1 && isBossFloor(i - 1); }
function mHalf(m) {
  if (m && m.kind === 'boss' && m.bkind && BOSS_META[m.bkind]) return BOSS_META[m.bkind].hit;
  return M_HIT[m.kind] || { x: 8, y: 8 };
}
const LOOT = [['rune', 0.45], ['heal', 0.30], ['xp', 0.15], ['coin', 0.10]];
function rollLoot() { let r = rng(); for (const [k, p] of LOOT) { if (r < p) return k; r -= p; } return 'coin'; }
const PAL = {
  ink: '#09080c', ink2: '#121018', ink3: '#1c1826', stone: '#2d2738', stone2: '#413852',
  stone3: '#5b4f70', shade: '#221d2b',
  green: '#6bc968', green2: '#3d8241', red: '#e03c31', red2: '#961e1e',
  cyan: '#48c9b0', cyan2: '#278a78', gold: '#ebb34b', gold2: '#9e6d22',
  violet: '#b07cf0', violet2: '#7d4ec2', violet3: '#4c2c80',
  hi: '#f4ecdc', mut: '#9a8f80', dark: '#191521',
};

/* ---------- AI 角色部件（assets/herox_*_n.png）：上半身 + 手绘腿 ---------- */
const LEG_IDLE = [], LEG_JUMP = [], LEG_FALL = [], LEG_CLIMB = [], LEG_DASH = [], LEG_RUN = [], LEG_WALK = [];
const READY_LEG = { idle: 0, jump: 0, fall: 0, climb: 0, dash: 0, run: 0, walk: 0 };
function loadLegs(arrName, prefix, n) {
  const arr = { LEG_IDLE, LEG_JUMP, LEG_FALL, LEG_CLIMB, LEG_DASH, LEG_RUN, LEG_WALK }[arrName];
  for (let i = 0; i < n; i++) {
    const im = new Image();
    im.onload = () => { READY_LEG[prefix]++; };
    im.onerror = () => { S.errors.push('legs ' + prefix + ' missing'); };
    im.src = 'assets/herox_legs_' + prefix + '_' + i + '_n.png';
    arr[i] = im;
  }
}
loadLegs('LEG_IDLE', 'idle', 2); loadLegs('LEG_JUMP', 'jump', 2); loadLegs('LEG_FALL', 'fall', 2);
loadLegs('LEG_CLIMB', 'climb', 4); loadLegs('LEG_DASH', 'dash', 4); loadLegs('LEG_RUN', 'run', 8); loadLegs('LEG_WALK', 'walk', 8);
const UPPER_LEAN6 = new Image(); let LEAN6_READY = 0;
UPPER_LEAN6.onload = () => { LEAN6_READY++; }; UPPER_LEAN6.onerror = () => { S.errors.push('lean6 missing'); };
UPPER_LEAN6.src = 'assets/herox_upper_lean6_n.png';
const UPPER_LEAN10 = new Image(); let LEAN10_READY = 0;
UPPER_LEAN10.onload = () => { LEAN10_READY++; }; UPPER_LEAN10.onerror = () => { S.errors.push('lean10 missing'); };
UPPER_LEAN10.src = 'assets/herox_upper_lean10_n.png';
const UPPER_LEAN12 = new Image(); let LEAN12_READY = 0;
UPPER_LEAN12.onload = () => { LEAN12_READY++; }; UPPER_LEAN12.onerror = () => { S.errors.push('lean12 missing'); };
UPPER_LEAN12.src = 'assets/herox_upper_lean12_n.png';
const UPPER_LEAN18 = new Image(); let LEAN18_READY = 0;
UPPER_LEAN18.onload = () => { LEAN18_READY++; }; UPPER_LEAN18.onerror = () => { S.errors.push('lean18 missing'); };
UPPER_LEAN18.src = 'assets/herox_upper_lean18_n.png';
const UPPER_IMG = new Image();
let UPPER_READY = 0;
UPPER_IMG.onload = () => { UPPER_READY++; };
UPPER_IMG.onerror = () => { S.errors.push('upper asset missing'); };
UPPER_IMG.src = 'assets/herox_upper_n.png';
const UPPER_CAPE = new Image();
let CAPE_READY = 0;
UPPER_CAPE.onload = () => { CAPE_READY++; };
UPPER_CAPE.onerror = () => { S.errors.push('cape layer missing'); };
UPPER_CAPE.src = 'assets/herox_upper_cape_n.png';
const UPPER_NOHAND = new Image();
let NOHAND_READY = 0;
UPPER_NOHAND.onload = () => { NOHAND_READY++; };
UPPER_NOHAND.onerror = () => { S.errors.push('nohand upper missing'); };
UPPER_NOHAND.src = 'assets/herox_upper_nohand_n.png';
const HAND_IMG = new Image();
let HAND_READY = 0;
HAND_IMG.onload = () => { HAND_READY++; };
HAND_IMG.onerror = () => { S.errors.push('hand layer missing'); };
HAND_IMG.src = 'assets/herox_upper_hand_n.png';
const ATK_IMGS = { knife: [], hammer: [], crossbow: [], orb: [], long: [] };
const ATK_READY = { knife: 0, hammer: 0, crossbow: 0, orb: 0, long: 0 };
const ATK_SRC = {
  knife: [0,1,2,3].map(i => 'herox_atk_knife_' + i + '_n.png'),
  hammer: [0,1,2,3].map(i => 'herox_atk_hammer_' + i + '_n.png'),
  crossbow: [0,1,2].map(i => 'herox_atk_ranged_' + i + '_n.png'),
  orb: [3,4,5].map(i => 'herox_atk_ranged_' + i + '_n.png'),
  long: [0,1,2,3].map(i => 'herox_atk_long_' + i + '_n.png'),
};
for (const k in ATK_SRC) ATK_SRC[k].forEach((name, i) => {
  const im = new Image();
  im.onload = () => { ATK_READY[k]++; };
  im.onerror = () => { S.errors.push('atk asset missing: ' + name); };
  im.src = 'assets/' + name;
  ATK_IMGS[k][i] = im;
});
const DEATH_IMGS = [];
let DEATH_READY = 0;
[0,1,2,3].forEach(i => {
  const im = new Image();
  im.onload = () => { DEATH_READY++; };
  im.onerror = () => { S.errors.push('death asset missing'); };
  im.src = 'assets/herox_death_' + i + '_n.png';
  DEATH_IMGS[i] = im;
});
const ACT_W = 96, ACT_H = 76, ACT_FOOT = 73; /* 动作整帧：96x76，脚底在 y=73 */
const ATK_META = { long: { w: 96, h: 100, foot: 97 } };
/* 程序怪每种材质仅暗/中/亮三档；不改全局 PAL/UI。 */
const UNIT_TONE = {
  stone: ['#393340', '#6b6178', '#aea2b8'],
  violet: ['#443653', '#82609f', '#b7a0cc'],
  red: ['#592938', '#aa4d52', '#dc8b7a'],
  brass: ['#684432', '#ac774f', '#ddbb83'],
  cyan: ['#24504d', '#448c83', '#a1c9b6'],
};
const HERO_IMAGE_CACHE = new WeakMap();
function heroImage(im, w, h) {
  let sizes = HERO_IMAGE_CACHE.get(im);
  if (!sizes) { sizes = new Map(); HERO_IMAGE_CACHE.set(im, sizes); }
  const key = w + 'x' + h;
  if (sizes.has(key)) return sizes.get(key);
  const [c, g] = mkc(w, h);
  g.imageSmoothingEnabled = true;
  g.drawImage(im, 0, 0, w, h);
  g.imageSmoothingEnabled = false;
  sizes.set(key, c);
  return c;
}
/* 仅主角使用两个固定小画布：合成后光边跟随真实 alpha，不做矩形光晕。 */
const [HERO_LAYER, HERO_G] = mkc(256, 192);
const [HERO_EDGE, HERO_EG] = mkc(256, 192);
function drawHeroComposite(g, X, Y, anim, face) {
  HERO_G.clearRect(0, 0, 256, 192);
  HERO_G.save();
  drawRunHybrid(HERO_G, 128, 128, anim, face);
  HERO_G.restore();
  HERO_EG.clearRect(0, 0, 256, 192);
  HERO_EG.save();
  HERO_EG.drawImage(HERO_LAYER, -1, 0);
  HERO_EG.drawImage(HERO_LAYER, 0, -1);
  HERO_EG.globalCompositeOperation = 'source-in';
  HERO_EG.fillStyle = '#786c79';
  HERO_EG.fillRect(0, 0, 256, 192);
  HERO_EG.globalCompositeOperation = 'destination-out';
  HERO_EG.drawImage(HERO_LAYER, 0, 0);
  HERO_EG.restore();
  const left = Math.round(X) - 128, top = Math.round(Y) - 128;
  g.save();
  g.imageSmoothingEnabled = false;
  g.drawImage(HERO_EDGE, left, top);
  g.drawImage(HERO_LAYER, left, top);
  g.restore();
}
function drawHeroAI(g, X, Y, idx, face, bob, arr, meta, ox, sx, sy) {
  const source = arr[idx];
  if (!source || !source.complete || !source.naturalWidth) return false;
  const im = heroImage(source, meta ? meta.w : ACT_W, meta ? meta.h : ACT_H);
  const feetY = Math.round(Y) + Math.round(P.h / 2) + (bob || 0);
  const fw = meta ? meta.w : ACT_W, fh = meta ? meta.h : ACT_H;
  const top = feetY - (meta ? meta.foot : ACT_FOOT);
  const cx0 = Math.round(X) + (ox || 0);
  const left = cx0 - fw / 2;
  const useScale = (sx && sx !== 1) || (sy && sy !== 1);
  if (face < 0 || useScale) {
    g.save();
    g.translate(cx0, feetY);
    g.scale((face < 0 ? -1 : 1) * (sx || 1), sy || 1);
    g.translate(-cx0, -feetY);
    g.drawImage(im, left, top, fw, fh);
    g.restore();
  } else g.drawImage(im, left, top, fw, fh);
  return true;
}
const cv = document.getElementById('cv');
const cx = cv.getContext('2d');
cx.imageSmoothingEnabled = false;
const uiCv = document.getElementById('ui');
const U = uiCv.getContext('2d');
let WS = 2;      /* 世界层超采样倍率（整数，保证像素边缘锐利） */
let MAX_WS = 2;  /* 本设备上限 */
let DEVPX = 640; /* 屏幕设备像素高度（用于选择显示采样） */
let lowStreak = 0;
let US = 1;      /* UI 层 逻辑→设备 缩放 */
let VIEW_SCALE = 1; /* 逻辑像素 → CSS 像素，用于保证触控热区实际尺寸 */
/* ---------- 横竖屏适配：手机竖屏持握时强制横屏呈现（创空间 iframe 内无法依赖系统自动旋转） ---------- */
const ORIENT = { forced: false, dir: 1, lockTried: false, sensorBound: false, toastShown: false, dimTimer: 0 };
function fit() {
  /* 尺寸：按可用区域铺满；清晰度：世界层整数超采样 + UI 层按 dpr 原生渲染 */
  const margin = 8;
  const wrapEl = document.getElementById('wrap');
  /* offsetWidth/Height 是变换前的布局尺寸：强制横屏时 body 被旋转，getBoundingClientRect 会宽高互换 */
  const availW = Math.max(240, wrapEl.offsetWidth || innerWidth);
  const availH = Math.max(320, wrapEl.offsetHeight || innerHeight);
  const h = Math.min(availH - margin, (availW - margin) * CFG.H / CFG.W);
  const cssW = Math.floor(h * CFG.W / CFG.H);
  const cssH = Math.floor(h);
  VIEW_SCALE = cssH / CFG.H;
  cv.style.width = cssW + 'px';
  cv.style.height = cssH + 'px';
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const want = Math.max(cssW * dpr / CFG.W, cssH * dpr / CFG.H);
  WS = Math.max(2, Math.min(4, Math.round(want)));
  /* 太大会拖性能：720×405 允许 3× 超采样，总像素上限 320 万 */
  while (WS > 2 && CFG.W * WS * CFG.H * WS > 3200000) WS--;
  cv.width = CFG.W * WS;
  cv.height = CFG.H * WS;
  cx.imageSmoothingEnabled = false;
  /* 缩小显示时用平滑，避免 nearest 降采样造成抖动；放大时保持像素锐利 */
  const downscale = CFG.H * WS > cssH * dpr;
  cv.style.imageRendering = downscale ? 'auto' : 'pixelated';
  MAX_WS = WS; DEVPX = cssH * dpr;
  const r = cv.getBoundingClientRect();
  /* 强制横屏时 uiCv 的包含块是旋转后的 body：把视口坐标反变换回舞台坐标，宽高也要换回 */
  const rw = ORIENT.forced ? r.height : r.width;
  const rh = ORIENT.forced ? r.width : r.height;
  let uiLeft = r.left, uiTop = r.top;
  if (ORIENT.forced) {
    if (ORIENT.dir > 0) { uiLeft = r.top; uiTop = document.body.offsetHeight - r.right; }
    else { uiLeft = document.body.offsetWidth - r.bottom; uiTop = r.left; }
  }
  uiCv.style.left = uiLeft + 'px'; uiCv.style.top = uiTop + 'px';
  uiCv.style.width = rw + 'px'; uiCv.style.height = rh + 'px';
  uiCv.width = Math.max(1, Math.round(rw * dpr));
  uiCv.height = Math.max(1, Math.round(rh * dpr));
  US = uiCv.width / CFG.W;
  U.imageSmoothingEnabled = true;
}
/* 竖屏 + 触屏设备 → 旋转整个舞台；桌面窄窗口保持原有竖屏 DOM 菜单 */
function orientShouldForce() {
  if (innerHeight <= innerWidth) return false;
  let coarse = false;
  try { coarse = matchMedia('(pointer: coarse)').matches; } catch (_) {}
  return coarse || (navigator.maxTouchPoints || 0) > 0;
}
const orientProbe = document.createElement('div');
orientProbe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top);padding-right:env(safe-area-inset-right);padding-bottom:env(safe-area-inset-bottom);padding-left:env(safe-area-inset-left);';
document.body.appendChild(orientProbe);
function orientSafeArea() {
  /* 旋转后舞台的上下左右对应物理屏幕的不同边，安全区要跟着换边，刘海屏才不会挡住按钮 */
  const root = document.documentElement.style;
  if (!ORIENT.forced) { root.removeProperty('--sa-t'); root.removeProperty('--sa-r'); root.removeProperty('--sa-b'); root.removeProperty('--sa-l'); return; }
  const cs = getComputedStyle(orientProbe);
  const t = parseFloat(cs.paddingTop) || 0, r = parseFloat(cs.paddingRight) || 0, b = parseFloat(cs.paddingBottom) || 0, l = parseFloat(cs.paddingLeft) || 0;
  const map = ORIENT.dir > 0 ? [r, b, l, t] : [l, t, r, b];
  root.setProperty('--sa-t', map[0] + 'px'); root.setProperty('--sa-r', map[1] + 'px');
  root.setProperty('--sa-b', map[2] + 'px'); root.setProperty('--sa-l', map[3] + 'px');
}
let orientToastTimer = 0;
function orientToast(msg) {
  const el = document.getElementById('orient-toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(orientToastTimer);
  orientToastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}
function orientApply() {
  const force = orientShouldForce();
  const changed = force !== ORIENT.forced;
  ORIENT.forced = force;
  const root = document.documentElement;
  root.classList.toggle('force-landscape', force);
  root.classList.toggle('orient-flip', force && ORIENT.dir < 0);
  const bs = document.body.style;
  if (force) { bs.width = innerHeight + 'px'; bs.height = innerWidth + 'px'; }
  else { bs.width = ''; bs.height = ''; }
  orientSafeArea();
  const flip = document.getElementById('orient-flip');
  if (flip) {
    flip.classList.remove('dim');
    clearTimeout(ORIENT.dimTimer);
    if (force) ORIENT.dimTimer = setTimeout(() => flip.classList.add('dim'), 5000);
  }
  fit();
  if (changed && force && !ORIENT.toastShown) { ORIENT.toastShown = true; orientToast('已自动横屏 · 转动手机可自动适配方向'); }
}
function orientSensor(e) {
  /* 系统旋转被锁定时，用重力感应判断用户把手机转向了哪一侧，画面跟着翻面（gamma≈-90 顶部朝左 / +90 顶部朝右） */
  if (!ORIENT.forced || typeof e.gamma !== 'number' || !isFinite(e.gamma)) return;
  const want = e.gamma < -55 ? 1 : e.gamma > 55 ? -1 : 0;
  if (want && want !== ORIENT.dir) { ORIENT.dir = want; orientApply(); orientToast('已切换横屏方向'); }
}
function orientSensorListen() {
  if (ORIENT.sensorBound) return;
  ORIENT.sensorBound = true;
  addEventListener('deviceorientation', orientSensor);
}
function orientTryFullscreenLock() {
  try {
    if (!document.fullscreenEnabled || document.fullscreenElement) return;
    const p = document.documentElement.requestFullscreen();
    if (p && p.then) p.then(() => {
      try { const so = screen.orientation; if (so && so.lock) { const q = so.lock('landscape'); if (q && q.catch) q.catch(() => {}); } } catch (_) {}
    }).catch(() => {});
  } catch (_) {}
}
function orientTryLock() {
  /* 首次触摸时尽力争取系统级横屏：直接 lock 失败则尝试全屏后 lock；全部静默失败时仍有 CSS 旋转兜底 */
  if (!ORIENT.forced || ORIENT.lockTried) return;
  ORIENT.lockTried = true;
  try {
    const so = screen.orientation;
    if (so && typeof so.lock === 'function') {
      const p = so.lock('landscape');
      if (p && p.catch) p.catch(() => orientTryFullscreenLock());
    } else orientTryFullscreenLock();
  } catch (_) { orientTryFullscreenLock(); }
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      DeviceOrientationEvent.requestPermission().then(res => { if (res === 'granted') orientSensorListen(); }).catch(() => {});
    }
  } catch (_) {}
}
document.addEventListener('pointerdown', orientTryLock, true);
const orientFlipBtn = document.getElementById('orient-flip');
if (orientFlipBtn) orientFlipBtn.addEventListener('click', () => { ORIENT.dir = -ORIENT.dir; orientApply(); orientToast('已切换横屏方向'); });
if (typeof DeviceOrientationEvent === 'undefined' || typeof DeviceOrientationEvent.requestPermission !== 'function') orientSensorListen();
addEventListener('resize', orientApply);
if (window.visualViewport) window.visualViewport.addEventListener('resize', orientApply);
orientApply();
function setScale(n) {
  WS = Math.max(2, Math.min(4, n | 0));
  const cvEl = document.getElementById('cv');
  cvEl.width = CFG.W * WS; cvEl.height = CFG.H * WS;
  cx.imageSmoothingEnabled = false;
  cvEl.style.imageRendering = (CFG.H * WS > DEVPX) ? 'auto' : 'pixelated';
}

/* ---------- 音效引擎：独立干湿总线 + 音频时钟分段循环 / 短交叉淡化 ---------- */
const AUD = { ctx: null, master: null, sfxBus: null, noise: null, revIn: null, last: {}, critLast: {}, lowStamp: [], alertUntil: 0, quiet: false };
const MUS = {
  on: false, bus: null, rev: null, output: null, synthMix: null, trackBus: null, voices: [], timer: null, next: 0, step: 0, phase: 'menu', phaseAt: 0, lastTarget: null,
  buffers: null, loading: null, audioReady: false, error: null, track: null, tracks: [], trackTarget: null, synthTarget: null, revTarget: null,
  fileAudio: null, fileReady: false, fileSection: null, fileTarget: null
};
const TRACK_FADE = 0.12;
const TRACK_SEAM = 0.04;
const MUS_BUS = 0.16;
const TRACK_CLIMB_VOL = 0.14; // 常规爬楼音量：柔和不抢耳，完全突显武器挥砍与受击音效
const TRACK_BOSS_VOL = 0.18;  // BOSS 战音量：稍作扬起，压迫感十足
const TRACK_INTRO_VOL = 0.11; // 门厅与主菜单音量：幽暗微弱

/* 音乐分段体系：小层与大层之间连贯流淌不切换，唯有进入 BOSS 关卡才切到最激烈爆发部分 */
const INTRO_START = 0.0;
const INTRO_END = 32.8;        // 门厅/主菜单前奏区间 [0.0s, 32.8s]
const CLIMB_LOOP_START = 32.8; // 常规爬楼段起点（0:33 稳健律动）
const CLIMB_LOOP_END = 81.8;   // 常规爬楼段终点（1:21.8 乐段闭合）
const BOSS_LOOP_START = 82.0;  // 最激烈 BOSS 战起点（1:22 电吉他金属爆发与双踩高潮）
const BOSS_LOOP_END = 132.6;   // 最激烈 BOSS 战终点（2:12.6 8-bit Solo 乐段闭合）

function fadeAudioGain(param, value, duration) {
  const t = AUD.ctx.currentTime;
  if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(t);
  else { const current = param.value; param.cancelScheduledValues(t); param.setValueAtTime(current, t); }
  param.linearRampToValueAtTime(value, t + duration);
}
function makeTrackLoop(buffer, start, end) {
  const rate = buffer.sampleRate, first = Math.round(start * rate), last = Math.round(end * rate);
  const overlap = Math.round(TRACK_SEAM * rate), length = last - first - overlap;
  if (last > buffer.length || length <= overlap) throw new Error('BGM segment is incomplete');
  const loop = AUD.ctx.createBuffer(buffer.numberOfChannels, length, rate);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const input = buffer.getChannelData(ch), output = loop.getChannelData(ch);
    output.set(input.subarray(first + overlap, last));
    // 将尾部与段首 40ms 交叉混合，循环交给音频时钟；不宣称乐句/采样无缝。
    for (let i = 0; i < overlap; i++) {
      const mix = i / (overlap - 1), j = length - overlap + i;
      output[j] = output[j] * (1 - mix) + input[first + i] * mix;
    }
  }
  return loop;
}
const BGM_SEGMENTS = {
  menu: [INTRO_START, INTRO_END],
  climb: [CLIMB_LOOP_START, CLIMB_LOOP_END],
  boss: [BOSS_LOOP_START, BOSS_LOOP_END],
};
function initFileBgm() {
  if (MUS.fileAudio) return;
  MUS.fileReason = location.protocol === 'file:' ? 'file-protocol' : 'fetch-or-decode-failed';
  try {
    const a = new Audio();
    a.preload = 'auto'; a.loop = false; a.volume = 0;
    a.addEventListener('timeupdate', () => {
      if (!MUS.on || S.meta.bgm === false) { try { a.pause(); } catch (e) {} return; }
      const seg = BGM_SEGMENTS[MUS.fileSection];
      if (seg && a.currentTime >= seg[1]) { try { a.currentTime = seg[0]; } catch (e) {} }
    });
    a.addEventListener('canplay', () => { MUS.fileReady = true; if (MUS.on) syncTrackA(); });
    a.addEventListener('error', () => { MUS.fileReady = false; });
    a.src = 'assets/bgm_battle.mp3';
    MUS.fileAudio = a;
  } catch (e) { MUS.fileAudio = null; }
}
function initBgmAudio() {
  if (!AUD.ctx || MUS.buffers || MUS.loading || MUS.error) return;
  if (location.protocol === 'file:') { initFileBgm(); return; }
  const c = AUD.ctx;
  // 异步回调只缓存数据，绝不启动音源；停止期间加载完成也不会复活音乐。
  MUS.loading = Promise.resolve().then(() => fetch('assets/bgm_battle.mp3'))
    .then(r => { if (!r.ok) throw new Error('BGM HTTP ' + r.status); return r.arrayBuffer(); })
    .then(data => c.decodeAudioData(data))
    .then(buffer => {
      MUS.buffers = {
        menu: makeTrackLoop(buffer, INTRO_START, INTRO_END),
        climb: makeTrackLoop(buffer, CLIMB_LOOP_START, CLIMB_LOOP_END),
        boss: makeTrackLoop(buffer, BOSS_LOOP_START, BOSS_LOOP_END)
      };
      MUS.audioReady = true;
      if (MUS.fileAudio) { try { MUS.fileAudio.pause(); } catch (e) {} }
    })
    .catch(e => {
      MUS.audioReady = false; MUS.error = String(e && e.message || e);
      (MUS.failures || (MUS.failures = [])).push({ message: MUS.error, protocol: location.protocol });
      initFileBgm(); if (MUS.on) syncTrackA();
    })
    .finally(() => { MUS.loading = null; });
}
function syncFileBgm(key) {
  if (!MUS.fileAudio) initFileBgm();
  const a = MUS.fileAudio;
  if (!a) return;
  if (!key) { try { a.pause(); } catch (e) {} return; }
  const seg = BGM_SEGMENTS[key];
  if (MUS.fileSection !== key) {
    MUS.fileSection = key;
    try { a.currentTime = seg[0]; } catch (e) {}
  } else if (!a.paused && a.currentTime >= seg[1] - 0.03) {
    try { a.currentTime = seg[0]; } catch (e) {}
  }
  if (a.paused) { const p = a.play(); if (p && p.catch) p.catch(() => {}); }
}
function stopTrack(voice) {
  if (!voice || voice.stopping) return;
  voice.stopping = true;
  fadeAudioGain(voice.gain.gain, 0, TRACK_FADE);
  try { voice.source.stop(AUD.ctx.currentTime + TRACK_FADE + 0.01); } catch (e) {}
}
function syncTrackA() {
  if (!AUD.ctx) return;
  if (!MUS.on || S.meta.bgm === false) {
    if (MUS.fileAudio) { try { MUS.fileAudio.pause(); } catch (e) {} }
    return;
  }
  const inGame = S.screen === 'playing' && !S.hall;
  const bossActive = inGame && (!!(S.arena && S.arena.active) || !!(S.boss && !S.boss.dormant));
  const key = P.dead || S.screen === 'dead' ? null : (inGame ? (bossActive ? 'boss' : 'climb') : 'menu');
  if (!key) {
    stopTrack(MUS.track); MUS.track = null;
    syncFileBgm(null);
  } else if ((!MUS.audioReady || !MUS.buffers) && MUS.fileAudio) {
    // 仅当解码已失败、或本地文件模式已启用时才用回退音源；加载中继续播放备用合成曲。
    syncFileBgm(key);
  } else if (MUS.audioReady && MUS.buffers && MUS.trackBus && (!MUS.track || MUS.track.key !== key)) {
    const c = AUD.ctx, source = c.createBufferSource(), gain = c.createGain();
    source.buffer = MUS.buffers[key]; source.loop = true;
    gain.gain.value = 0; source.connect(gain); gain.connect(MUS.trackBus);
    const voice = { source, gain, key, started: c.currentTime, stopping: false };
    source.onended = () => {
      source.disconnect(); gain.disconnect();
      MUS.tracks = MUS.tracks.filter(v => v !== voice);
      if (MUS.track === voice) { MUS.track = null; MUS.audioReady = false; MUS.error = 'BGM source ended unexpectedly'; }
    };
    try {
      source.start(voice.started);
      fadeAudioGain(gain.gain, 1, TRACK_FADE);
      stopTrack(MUS.track); MUS.track = voice; MUS.tracks.push(voice);
    } catch (e) {
      source.onended = null; source.disconnect(); gain.disconnect();
      stopTrack(MUS.track); MUS.track = null;
      MUS.audioReady = false; MUS.error = String(e && e.message || e);
    }
  }
  if (MUS.audioReady && MUS.fileAudio) { try { MUS.fileAudio.pause(); } catch (e) {} }
  syncMusicDuck();
}
function musicVoice(source) {
  MUS.voices.push(source);
  source.onended = () => { MUS.voices = MUS.voices.filter(v => v !== source); source.disconnect(); };
}

function makeImpulse(c, dur) {
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.6) * 0.55;
    }
  }
  return buf;
}
function audioReverb(output, impulse) {
  const c = AUD.ctx, rev = c.createConvolver(); rev.buffer = impulse;
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2300;
  const rg = c.createGain(); rg.gain.value = 0.5;
  const input = c.createGain();
  input.connect(rev); rev.connect(lp); lp.connect(rg); rg.connect(output);
  return input;
}
function audioInit() {
  if (AUD.ctx) {
    if (AUD.ctx.state === 'suspended') AUD.ctx.resume().catch(() => {});
    syncSoundVolume();
    if (S.meta.bgm !== false) musicStart();
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  try {
    const c = new AC();
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 16; comp.ratio.value = 6;
    comp.attack.value = 0.003; comp.release.value = 0.22;
    const m = c.createGain();
    m.gain.value = 0.6; // 保留合成音的既有输出电平
    m.connect(comp); comp.connect(c.destination);
    AUD.ctx = c; AUD.master = m;
    const sfxBus = c.createGain();
    sfxBus.gain.value = S.meta.sound === false ? 0 : getSoundVolume();
    sfxBus.connect(m); AUD.sfxBus = sfxBus;
    /* 两个独立卷积器，返回各自音量门之前；静音连同当前干声与混响尾音一起淡出。 */
    const impulse = makeImpulse(c, 1.35);
    AUD.revIn = audioReverb(sfxBus, impulse);
    MUS.output = c.createGain(); MUS.output.gain.value = 0; MUS.output.connect(m);
    MUS.synthMix = c.createGain(); MUS.synthMix.connect(MUS.output);
    MUS.bus = c.createGain(); MUS.bus.gain.value = 0; MUS.bus.connect(MUS.synthMix);
    MUS.rev = audioReverb(MUS.synthMix, impulse);
    // MP3 维持原 HTML Audio 的直达输出 / 相对音量，不重复经过合成音压缩器。
    MUS.trackBus = c.createGain(); MUS.trackBus.gain.value = 0; MUS.trackBus.connect(c.destination);
    const len = Math.floor(c.sampleRate * 0.5);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    AUD.noise = buf;
    if (c.state === 'suspended') c.resume().catch(() => {});
    if (S.meta.bgm !== false) musicStart();
  } catch (e) { AUD.ctx = null; }
}
function audioOut(node, o) {
  if (!AUD.ctx) return;
  const c = AUD.ctx;
  let n = node;
  if (o.pan) {
    const p = c.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, o.pan));
    n.connect(p); n = p;
  }
  n.connect(o.out || AUD.sfxBus);
  if (o.rev && AUD.revIn) {
    const s = c.createGain(); s.gain.value = Math.min(1, o.rev);
    n.connect(s);
    s.connect(o.out === MUS.bus ? MUS.rev : AUD.revIn);
  }
}
function atone(freq, dur, o) {
  if (!AUD.ctx) return;
  o = o || {};
  const c = AUD.ctx, t0 = o.at !== undefined ? o.at : c.currentTime + (o.delay || 0), pf = o.pitch || 1;
  const osc = c.createOscillator(), g = c.createGain();
  osc.type = o.type || 'sine';
  osc.frequency.setValueAtTime(Math.max(20, freq * pf), t0);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to * pf), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(o.gain === undefined ? 0.1 : o.gain, t0 + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g); audioOut(g, o);
  if (o.out === MUS.bus) musicVoice(osc);
  osc.start(t0); osc.stop(t0 + dur + 0.02);
}
function anoise(dur, o) {
  if (!AUD.ctx) return;
  o = o || {};
  const c = AUD.ctx, t0 = o.at !== undefined ? o.at : c.currentTime + (o.delay || 0), pf = o.pitch || 1;
  const src = c.createBufferSource(); src.buffer = AUD.noise; src.loop = true;
  const f = c.createBiquadFilter(); f.type = o.type || 'bandpass';
  f.frequency.setValueAtTime((o.freq || 1200) * pf, t0);
  if (o.to) f.frequency.exponentialRampToValueAtTime(Math.max(40, o.to * pf), t0 + dur);
  f.Q.value = o.q || 1;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(o.gain === undefined ? 0.1 : o.gain, t0 + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f); f.connect(g); audioOut(g, o);
  if (o.out === MUS.bus) musicVoice(src);
  src.start(t0); src.stop(t0 + dur + 0.02);
}
function metal(base, dur, gain, o) {
  o = o || {};
  [1, 2.41, 3.83, 5.17].forEach((r, i) => {
    atone(base * r, dur * (1 - i * 0.16), Object.assign({}, o, {
      type: 'sine', gain: gain / (1 + i * 0.9), delay: (o.delay || 0) + i * 0.002,
    }));
  });
}
function apad(freq, dur, gain, t, o) {
  if (!AUD.ctx || !MUS.bus) return;
  const c = AUD.ctx;
  for (const dt of [-5, 6]) {
    const osc = c.createOscillator(); osc.type = 'triangle';
    osc.frequency.value = freq; osc.detune.value = dt;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1100; f.Q.value = 0.4;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 2.2);
    g.gain.setValueAtTime(gain, t + Math.max(2.3, dur - 3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(f); f.connect(g); g.connect(MUS.bus);
    if (MUS.rev) { const s = c.createGain(); s.gain.value = 0.06; g.connect(s); s.connect(MUS.rev); }
    osc.start(t); osc.stop(t + dur + 0.05);
    musicVoice(osc);
  }
}
function musicStart() {
  if (S.meta.bgm === false || !AUD.ctx || !MUS.output) return;
  if (AUD.ctx.state === 'suspended') AUD.ctx.resume().catch(() => {});
  if (MUS.on) { syncTrackA(); return; } // 重复用户手势不重置播放位置或备用曲节拍
  MUS.on = true;
  MUS.error = null; MUS.audioReady = !!MUS.buffers;
  initBgmAudio();
  MUS.lastTarget = MUS.trackTarget = MUS.synthTarget = MUS.revTarget = MUS.fileTarget = null;
  fadeAudioGain(MUS.output.gain, getBgmVolume(), TRACK_FADE);
  MUS.next = AUD.ctx.currentTime + 0.05; MUS.step = 0;
  syncTrackA();
  if (!MUS.timer) MUS.timer = setInterval(musicTick, 100);
  musicTick();
}
function musicStop() {
  MUS.on = false;
  if (MUS.timer) { clearInterval(MUS.timer); MUS.timer = null; }
  if (AUD.ctx) {
    const t = AUD.ctx.currentTime;
    if (MUS.output) fadeAudioGain(MUS.output.gain, 0, 0.06);
    if (MUS.trackBus) fadeAudioGain(MUS.trackBus.gain, 0, 0.06);
    MUS.track = null;
    for (const voice of MUS.tracks) stopTrack(voice);
    for (const o of MUS.voices) { try { o.stop(t + 0.07); } catch (e) {} }
    MUS.voices.length = 0;
  }
  if (MUS.fileAudio) { try { MUS.fileAudio.pause(); MUS.fileAudio.volume = 0; } catch (e) {} }
  MUS.fileSection = null; MUS.fileTarget = null;
  MUS.lastTarget = MUS.trackTarget = MUS.synthTarget = MUS.revTarget = null;
}
const CHORDS = [
  [73.42, 110.00, 174.61, 329.63],
  [58.27, 87.31, 146.83, 220.00],
  [49.00, 73.42, 116.54, 174.61],
  [55.00, 82.41, 196.00, 293.66],
];
const BELLS = [293.66, 349.23, 440.00, 523.25, 440.00, 349.23, 329.63, 293.66];
const THEME = [293.66, 349.23, 440.00, 349.23, 329.63, 261.63];
/* 音乐阶段：安全探索 / 崩落迫近 / Boss 战 / 菜单与结算留白。状态需稳定 0.7s 才切换，避免临界抖动 */
function musicPhase() {
  const active = S.screen === 'playing' && !S.hall && !S.paused && !S.shopOpen && !S.bossRewardOpen && !S.panel && !S.helpOpen;
  const bossActive = !!(S.arena && S.arena.active) || !!(S.boss && !S.boss.dormant);
  const collapseNear = S.collapseOn && (S.collapseY - (P.y + P.h / 2) < 2.6 * CFG.FH);
  const timeNear = S.mode === 'limited' && S.timer <= 10;
  let raw = 'menu';
  if (active && bossActive) raw = 'boss';
  else if (active && (collapseNear || timeNear)) raw = 'danger';
  else if (active) raw = 'calm';
  else if (S.screen === 'dead') raw = 'quiet';
  const now = performance.now();
  if (raw !== MUS.phase) {
    if (now - MUS.phaseAt < 700) return MUS.phase;
    MUS.phase = raw; MUS.phaseAt = now;
    syncTrackA();
    syncMusicDuck();
  }
  return MUS.phase;
}
function musicStep(step, t) {
  /* 文件曲或本地回退曲存在时不再调度备用曲；音量为零不会误启第二套音乐。 */
  if (MUS.track || MUS.fileAudio) return;
  const bar = Math.floor(step / 8) % 8;
  const beat = step % 8;
  const phase = musicPhase();
  const ci = Math.floor(bar / 2) % 4;
  /* 长 pad：菜单/结算每 4 小节一次，游戏内每 2 小节一次 */
  const padBar = (phase === 'menu' || phase === 'quiet') ? bar % 4 === 0 : bar % 2 === 0;
  if (beat === 0 && padBar) {
    const ch = CHORDS[ci];
    for (let i = 0; i < ch.length; i++) apad(ch[i], 9.2, (0.032 - i * 0.004) * (phase === 'quiet' ? 0.7 : 1), t + i * 0.03);
    if (bar === 0 && phase !== 'quiet') anoise(5.0, { at: t, freq: 320, to: 120, q: 0.5, gain: 0.012, out: MUS.bus, rev: 0.12 });
  }
  if (beat === 0 && (phase === 'calm' || phase === 'danger' || phase === 'boss' || (phase === 'menu' && bar % 2 === 0))) {
    atone(CHORDS[ci][0] / 2, 1.3, { at: t, type: 'sine', gain: 0.06, out: MUS.bus, rev: 0.05 });
  }
  /* 同一主题动机：菜单稀疏、探索完整、危险加节奏、结算残缺 */
  const motif = THEME[(bar * 2 + (beat >= 4 ? 1 : 0)) % THEME.length];
  if (beat === 2 && (phase !== 'quiet' || bar % 2 === 0)) {
    const dead = S.screen === 'dead';
    atone(dead ? motif / 2 : BELLS[bar], dead ? 1.1 : 2.2, { at: t, type: 'sine', gain: dead ? 0.038 : 0.075, out: MUS.bus, rev: 0.1 });
    if (!dead && phase !== 'menu') atone(motif, 1.1, { at: t + 0.13, type: 'sine', gain: 0.022, out: MUS.bus, rev: 0.08 });
  }
  if (phase === 'danger' && (beat === 0 || beat === 4 || beat === 6)) {
    atone(beat === 0 ? 48.0 : 41.2, 0.30, { at: t, type: 'triangle', gain: 0.045, out: MUS.bus });
    anoise(0.12, { at: t, freq: beat === 0 ? 240 : 420, to: 100, type: 'lowpass', gain: 0.018, out: MUS.bus });
    if (beat === 6) atone(motif * 2, 0.22, { at: t, type: 'triangle', gain: 0.022, out: MUS.bus });
  }
  if (phase === 'boss' && (beat === 0 || beat === 4 || beat === 6)) {
    atone(beat === 4 ? 41.2 : 36.7, 0.42, { at: t, type: 'triangle', gain: 0.065, out: MUS.bus });
    anoise(0.18, { at: t, freq: 260, to: 80, type: 'lowpass', gain: 0.024, out: MUS.bus });
    if (beat === 0) atone(motif, 0.42, { at: t + 0.14, type: 'sawtooth', gain: 0.014, out: MUS.bus });
  }
}
function musicTick() {
  if (!AUD.ctx || !MUS.on || S.meta.bgm === false) return;
  syncTrackA();
  const now = AUD.ctx.currentTime;
  if (MUS.next < now - 0.6) MUS.next = now + 0.05;
  const stepDur = 0.52;
  while (MUS.next < now + 0.7) {
    musicStep(MUS.step, MUS.next);
    MUS.step = (MUS.step + 1) % 64;
    MUS.next += stepDur;
  }
}

const SFX_THROTTLE = { step: 70, ui: 60, coin: 45, xp: 50, hit: 28, kill: 40, floor: 120, warn: 450, parry: 35, enemylock: 90, enemyshot: 60, explode: 70, spike: 120, flame: 160, rock: 120, saw: 200, trapwarn: 140, emberimpact: 110 };
const SFX_PITCH = { swing: 0.06, hammer: 0.04, hit: 0.08, kill: 0.06, coin: 0.05, hurt: 0.04, jump: 0.05, parry: 0.06, enemyshot: 0.06, emberimpact: 0.03 };
/* 3=关键预警/自伤（独立节流并短暂压低音乐）；2=战斗与重要拾取；1=脚步/金币等装饰音（并发受限） */
const SFX_CRITICAL = new Set(['hurt', 'warn', 'trapwarn', 'enemylock', 'collapse', 'bosslaser', 'bosstimeout', 'death']);
const SFX_LOW = new Set(['step', 'coin', 'xp', 'floor', 'saw', 'flame', 'spike', 'enemyshot', 'ui']);
const SFX_CRITICAL_THROTTLE = { hurt: 70, warn: 220, trapwarn: 80, enemylock: 55, collapse: 500, bosslaser: 120, bosstimeout: 300, death: 500 };
function sfx(name, o) {
  if (!AUD.ctx || AUD.quiet || S.meta.sound === false || getSoundVolume() === 0) return;
  o = Object.assign({}, o);
  const now = performance.now();
  const priority = SFX_CRITICAL.has(name) ? 3 : (SFX_LOW.has(name) ? 1 : 2);
  const th = priority === 3 ? (SFX_CRITICAL_THROTTLE[name] || 70) : SFX_THROTTLE[name];
  const last = priority === 3 ? AUD.critLast[name] : AUD.last[name];
  if (th && last !== undefined && now - last < th) return;
  if (priority === 1) {
    AUD.lowStamp = AUD.lowStamp.filter(t => now - t < 90);
    // 装饰/敌方杂音独立限额；玩家动作不占额度，关键预警期间进一步收敛。
    if (AUD.lowStamp.length >= (now < AUD.alertUntil ? 1 : 3)) return;
    AUD.lowStamp.push(now);
  }
  AUD.last[name] = now;
  if (priority === 3) {
    AUD.critLast[name] = now;
    AUD.alertUntil = now + 380;
    syncMusicDuck();
  }
  if (!o.pitch && SFX_PITCH[name]) o.pitch = 1 + (Math.random() * 2 - 1) * SFX_PITCH[name];
  const T = (f, d, x) => atone(f, d, Object.assign({}, o, x));
  const N = (d, x) => anoise(d, Object.assign({}, o, x));
  switch (name) {
    case 'ui': N(0.03, { freq: 1600, to: 900, type: 'bandpass', q: 2, gain: 0.025 }); T(620, 0.03, { gain: 0.025, rev: 0.05 }); break;
    case 'start': N(0.5, { freq: 420, to: 110, type: 'lowpass', gain: 0.05, rev: 0.3 }); T(110, 0.35, { to: 180, gain: 0.1 }); T(523, 0.7, { gain: 0.03, delay: 0.12, rev: 0.45 }); break;
    case 'jump': N(0.08, { freq: 1200, to: 600, q: 1.2, gain: 0.04 }); T(260, 0.08, { to: 380, gain: 0.05 }); break;
    case 'djump': N(0.11, { freq: 1800, to: 800, q: 1.5, gain: 0.05 }); T(420, 0.09, { to: 620, gain: 0.05 }); break;
    case 'wall': N(0.09, { freq: 2200, to: 900, type: 'bandpass', gain: 0.05 }); T(160, 0.06, { to: 220, type: 'triangle', gain: 0.04 }); break;
    case 'swing': N(0.14, { freq: 3000, to: 800, q: 0.8, gain: 0.12, rev: 0.12 }); N(0.18, { freq: 1200, to: 400, q: 0.7, gain: 0.07, delay: 0.005 }); N(0.07, { freq: 600, to: 300, type: 'lowpass', gain: 0.04, delay: 0.01 }); T(180, 0.1, { to: 90, gain: 0.07 }); metal(2400, 0.16, 0.025, { delay: 0.02, rev: 0.2 }); T(5200, 0.02, { gain: 0.015, delay: 0.005 }); break;
    case 'hammer': N(0.18, { freq: 650, to: 120, type: 'lowpass', gain: 0.08 }); T(90, 0.16, { to: 48, gain: 0.1 }); T(1500, 0.06, { gain: 0.015, delay: 0.02 }); break;
    case 'longswing': N(0.24, { freq: 1100, to: 220, type: 'lowpass', gain: 0.08 }); T(100, 0.2, { to: 45, gain: 0.08 }); metal(1800, 0.2, 0.02, { rev: 0.25, delay: 0.02 }); break;
    case 'emberswing':
      /* 烬铁巨剑挥砍仅保留破空 / 金属刮擦；撞击与余烬声由实际命中触发。 */
      N(0.32, { freq: 900, to: 110, type: 'lowpass', gain: 0.14, rev: 0.28 });
      N(0.16, { freq: 2600, to: 700, q: 1.6, gain: 0.07, delay: 0.01 });
      N(0.10, { freq: 5200, to: 2200, q: 2.2, gain: 0.03, delay: 0.02 });
      T(105, 0.34, { to: 32, gain: 0.16, rev: 0.2 });
      T(52, 0.4, { to: 28, type: 'sawtooth', gain: 0.05, delay: 0.02, rev: 0.15 });
      metal(1250, 0.30, 0.028, { rev: 0.4, delay: 0.035 });
      break;
    case 'emberimpact':
      /* 烬铁巨剑命中：重剑闷响 + 熔岩爆燃 + 铁鸣余韵 + 噼啪飞烬 */
      T(64, 0.5, { to: 26, gain: 0.24, rev: 0.32 });
      N(0.34, { freq: 520, to: 70, type: 'lowpass', gain: 0.16, rev: 0.2 });
      metal(900, 0.42, 0.035, { rev: 0.45, delay: 0.01 });
      N(0.2, { freq: 1800, to: 400, q: 1.2, gain: 0.06, delay: 0.02 });
      N(0.5, { freq: 800, to: 220, type: 'bandpass', q: 0.7, gain: 0.05, delay: 0.03, rev: 0.35 });
      N(0.05, { freq: 4600, to: 2400, q: 2.4, gain: 0.025, delay: 0.09 });
      N(0.04, { freq: 3200, to: 1700, q: 2.2, gain: 0.018, delay: 0.16 });
      break;
    case 'shoot': T(150, 0.09, { to: 70, gain: 0.12, rev: 0.12 }); N(0.05, { freq: 700, to: 220, type: 'lowpass', gain: 0.07 }); N(0.02, { freq: 3200, to: 1600, q: 2.5, gain: 0.04, delay: 0.005 }); T(260, 0.16, { to: 190, type: 'triangle', gain: 0.035, delay: 0.01 }); T(390, 0.13, { to: 300, type: 'triangle', gain: 0.02, delay: 0.012 }); N(0.22, { freq: 3000, to: 900, q: 1.2, gain: 0.035, delay: 0.02, rev: 0.1 }); N(0.05, { freq: 300, q: 3, gain: 0.03, delay: 0.002 }); break;
    case 'orbcast': N(0.2, { freq: 1200, to: 300, q: 1.2, gain: 0.035 }); T(220, 0.22, { to: 440, gain: 0.045 }); T(660, 0.16, { to: 990, gain: 0.012, delay: 0.1 }); break;
    case 'hit': T(150, 0.1, { to: 65, gain: 0.13, rev: 0.12 }); N(0.06, { freq: 900, to: 250, type: 'lowpass', gain: 0.08 }); N(0.02, { freq: 3000, to: 2000, gain: 0.02 }); break;
    case 'kill': T(200, 0.14, { to: 70, type: 'triangle', gain: 0.1 }); N(0.1, { freq: 1400, to: 300, gain: 0.07 }); N(0.04, { freq: 800, to: 400, gain: 0.05, delay: 0.03 }); T(80, 0.2, { to: 40, gain: 0.06, rev: 0.18 }); break;
    case 'hurt': T(120, 0.2, { to: 52, gain: 0.15, rev: 0.15 }); N(0.14, { freq: 700, to: 180, type: 'lowpass', gain: 0.06 }); T(220, 0.12, { to: 110, type: 'sawtooth', gain: 0.03 }); break;
    case 'dodge': N(0.14, { freq: 1600, to: 500, q: 2, gain: 0.05 }); N(0.08, { freq: 3000, to: 1200, gain: 0.02 }); break;
    case 'step': N(0.045, { freq: 900, to: 300, type: 'lowpass', gain: 0.018 }); T(85, 0.04, { to: 55, gain: 0.02 }); N(0.012, { freq: 2400, to: 1200, gain: 0.006 }); break;
    case 'land': T(70, 0.12, { to: 40, gain: 0.08 }); N(0.08, { freq: 700, to: 150, type: 'lowpass', gain: 0.06, rev: 0.1 }); N(0.02, { freq: 1800, gain: 0.02 }); break;
    case 'dive': N(0.25, { freq: 1400, to: 300, q: 1, gain: 0.04 }); T(260, 0.2, { to: 80, gain: 0.06 }); break;
    case 'slam': T(75, 0.28, { to: 34, gain: 0.26, rev: 0.25 }); N(0.2, { freq: 600, to: 80, type: 'lowpass', gain: 0.15 }); N(0.03, { freq: 2200, to: 800, gain: 0.04, delay: 0.01 }); N(0.02, { freq: 1200, to: 600, gain: 0.03, delay: 0.13 }); break;
    case 'coin': metal(1800, 0.2, 0.03, { rev: 0.3 }); T(1200, 0.05, { gain: 0.02 }); break;
    case 'xp': T(880, 0.12, { to: 1180, gain: 0.04, rev: 0.15 }); T(1760, 0.08, { gain: 0.012, delay: 0.03 }); break;
    case 'heal': T(523, 0.3, { to: 659, gain: 0.05, rev: 0.3 }); T(784, 0.25, { gain: 0.025, delay: 0.08 }); N(0.15, { freq: 1200, to: 2400, gain: 0.015 }); break;
    case 'shard': T(1568, 0.18, { gain: 0.04, rev: 0.3 }); T(2093, 0.14, { gain: 0.02, delay: 0.03 }); break;
    case 'rune': [523, 659, 880].forEach((f, i) => T(f, 0.3, { gain: 0.035, delay: i * 0.07, rev: 0.35 })); break;
    case 'chest': N(0.15, { freq: 400, to: 1800, q: 1.2, gain: 0.04 }); T(160, 0.12, { to: 80, gain: 0.06 }); [659, 880, 1320].forEach((f, i) => T(f, 0.3, { gain: 0.03, delay: 0.08 + i * 0.06, rev: 0.35 })); break;
    case 'level': [523, 659, 784, 1047].forEach((f, i) => T(f, 0.3, { gain: 0.035, delay: i * 0.08, rev: 0.35 })); break;
    case 'floor': T(196, 0.08, { to: 220, gain: 0.035 }); N(0.02, { freq: 2000, gain: 0.01 }); break;
    case 'milestone': T(523, 0.5, { gain: 0.03, rev: 0.3 }); T(784, 0.4, { gain: 0.02, delay: 0.06 }); break;
    case 'gate': N(0.4, { freq: 300, to: 140, q: 1, gain: 0.05 }); T(90, 0.35, { to: 60, gain: 0.08, rev: 0.3 }); N(0.12, { freq: 1800, to: 600, gain: 0.02, delay: 0.05 }); break;
    case 'record': [659, 880, 1320].forEach((f, i) => T(f, 0.35, { gain: 0.035, delay: i * 0.08, rev: 0.35 })); break;
    case 'warn': T(70, 0.1, { gain: 0.08, rev: 0.1 }); T(70, 0.1, { gain: 0.06, delay: 0.16 }); N(0.03, { freq: 300, gain: 0.02 }); break;
    case 'death': T(220, 0.4, { to: 80, gain: 0.12, rev: 0.35 }); N(0.5, { freq: 600, to: 80, type: 'lowpass', gain: 0.06 }); T(110, 0.6, { to: 40, gain: 0.08, delay: 0.1 }); break;
    case 'collapse': T(48, 0.9, { to: 30, gain: 0.18, rev: 0.3 }); N(0.8, { freq: 200, to: 50, type: 'lowpass', gain: 0.1 }); N(0.15, { freq: 900, to: 300, gain: 0.02, delay: 0.2 }); break;
    case 'bossdown': T(70, 0.6, { to: 35, gain: 0.2, rev: 0.3 }); N(0.4, { freq: 500, to: 80, type: 'lowpass', gain: 0.1 }); [392, 523, 659, 784].forEach((f, i) => T(f, 0.35, { gain: 0.03, delay: 0.2 + i * 0.07, rev: 0.35 })); break;
    case 'revive': [392, 523, 659, 784].forEach((f, i) => T(f, 0.35, { gain: 0.03, delay: i * 0.08, rev: 0.35 })); break;
    case 'timeup': T(392, 0.2, { gain: 0.06, rev: 0.2 }); T(262, 0.35, { gain: 0.06, delay: 0.22 }); break;
    case 'boss': T(55, 0.6, { to: 38, gain: 0.16, rev: 0.3 }); N(0.5, { freq: 250, to: 60, type: 'lowpass', gain: 0.1 }); T(110, 0.4, { to: 70, type: 'triangle', gain: 0.05 }); break;
    case 'phase': T(60, 0.4, { to: 38, gain: 0.15, rev: 0.25 }); N(0.25, { freq: 300, to: 80, gain: 0.05 }); break;
    case 'buy': metal(1320, 0.18, 0.022, { rev: 0.25 }); T(880, 0.08, { gain: 0.03 }); T(1320, 0.1, { gain: 0.025, delay: 0.06 }); break;
    case 'deny': T(110, 0.08, { to: 90, gain: 0.06 }); T(98, 0.12, { gain: 0.05, delay: 0.1 }); N(0.04, { freq: 300, gain: 0.02 }); break;
    case 'parry': metal(2800, 0.14, 0.035, { rev: 0.2 }); T(1480, 0.06, { to: 2200, gain: 0.03 }); N(0.03, { freq: 3600, to: 1800, gain: 0.03 }); break;
    case 'enemylock': T(980, 0.06, { to: 1240, type: 'triangle', gain: 0.045 }); T(1320, 0.07, { to: 1560, type: 'triangle', gain: 0.04, delay: 0.08 }); break;
    case 'enemyshot': N(0.11, { freq: 1800, to: 520, q: 1.4, gain: 0.045 }); T(460, 0.10, { to: 190, type: 'sawtooth', gain: 0.035, rev: 0.12 }); break;
    case 'explode': T(88, 0.34, { to: 28, gain: 0.24, rev: 0.28 }); N(0.28, { freq: 720, to: 75, type: 'lowpass', gain: 0.16 }); N(0.06, { freq: 2400, to: 600, gain: 0.045, delay: 0.01 }); break;
    case 'spike': metal(1900, 0.10, 0.03, { rev: 0.1 }); N(0.05, { freq: 2600, to: 900, q: 1.5, gain: 0.05 }); T(240, 0.05, { to: 140, gain: 0.04 }); break;
    case 'flame': N(0.42, { freq: 900, to: 260, type: 'lowpass', gain: 0.09, rev: 0.15 }); N(0.2, { freq: 2400, to: 1200, q: 0.8, gain: 0.03 }); T(70, 0.3, { to: 50, gain: 0.05 }); break;
    case 'rock': T(62, 0.26, { to: 30, gain: 0.2, rev: 0.2 }); N(0.22, { freq: 520, to: 90, type: 'lowpass', gain: 0.14 }); N(0.05, { freq: 1600, to: 500, gain: 0.04, delay: 0.02 }); break;
    case 'saw': N(0.12, { freq: 3400, to: 2800, q: 4, gain: 0.025 }); T(1200, 0.12, { to: 1100, type: 'sawtooth', gain: 0.012 }); break;
    case 'trapwarn': T(640, 0.05, { to: 520, type: 'square', gain: 0.022 }); N(0.03, { freq: 1800, gain: 0.015 }); break;
    case 'pause': T(523, 0.06, { gain: 0.035, rev: 0.1 }); T(392, 0.09, { gain: 0.03, delay: 0.045, rev: 0.12 }); break;
    case 'resume': T(392, 0.05, { gain: 0.03, rev: 0.1 }); T(587, 0.09, { gain: 0.035, delay: 0.04, rev: 0.14 }); break;
    case 'bossseal': metal(420, 0.36, 0.05, { rev: 0.35 }); T(68, 0.55, { to: 34, gain: 0.22, rev: 0.3 }); N(0.32, { freq: 380, to: 70, type: 'lowpass', gain: 0.14 }); break;
    case 'bossopen': metal(1240, 0.24, 0.035, { rev: 0.3 }); [440, 554, 659, 880].forEach((f, i) => T(f, 0.28, { gain: 0.032, delay: i * 0.06, rev: 0.3 })); break;
    case 'bosstick': T(1046, 0.045, { type: 'triangle', gain: 0.035 }); break;
    case 'bosstimeout': T(130, 0.55, { to: 42, type: 'sawtooth', gain: 0.14, rev: 0.3 }); N(0.45, { freq: 420, to: 65, type: 'lowpass', gain: 0.12 }); break;
    case 'bosslaser': N(0.48, { freq: 1600, to: 480, q: 2.2, gain: 0.08, rev: 0.2 }); T(220, 0.45, { to: 110, type: 'sawtooth', gain: 0.06 }); break;
    case 'boon': [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => T(f, 0.38, { gain: 0.036, delay: i * 0.055, rev: 0.38 })); break;
  }
}
function syncMusicDuck() {
  if (!MUS.on || !AUD.ctx) return;
  const inGame = S.screen === 'playing' && !S.hall;
  const paused = S.paused && S.meta.bgm !== false;
  const alert = performance.now() < AUD.alertUntil;
  const bossActive = inGame && (!!(S.arena && S.arena.active) || !!(S.boss && !S.boss.dormant));
  const softDuck = S.shopOpen || S.bossRewardOpen || S.panel;
  const duckMul = paused ? 0.28 : (alert ? 0.55 : (softDuck ? 0.68 : 1));
  const duration = alert || paused ? 0.06 : 0.18;
  const volume = S.meta.bgm === false ? 0 : getBgmVolume();
  const baseVol = inGame ? (bossActive ? TRACK_BOSS_VOL : TRACK_CLIMB_VOL) : TRACK_INTRO_VOL;
  const trackTarget = P.dead || S.screen === 'dead' ? 0 : baseVol * duckMul * volume;
  if (MUS.trackBus && MUS.trackTarget !== trackTarget) {
    fadeAudioGain(MUS.trackBus.gain, trackTarget, duration); MUS.trackTarget = trackTarget;
  }
  if (MUS.bus) {
    const phaseGain = bossActive ? 1.08 : (inGame ? 1.0 : 0.74);
    const target = MUS_BUS * phaseGain * duckMul;
    if (MUS.lastTarget !== target) {
      fadeAudioGain(MUS.bus.gain, target, duration); MUS.lastTarget = target;
    }
    if (MUS.revTarget !== duckMul) {
      fadeAudioGain(MUS.rev.gain, duckMul, duration); MUS.revTarget = duckMul;
    }
    // 文件解码/播放失败或尚在加载时用原合成音乐；干声、混响一并交叉淡化。
    const synthTarget = (MUS.track || MUS.fileAudio) ? 0 : 1;
    if (MUS.synthTarget !== synthTarget) {
      fadeAudioGain(MUS.synthMix.gain, synthTarget, TRACK_FADE); MUS.synthTarget = synthTarget;
    }
  }
  if (MUS.fileAudio && MUS.fileTarget !== trackTarget) {
    try { MUS.fileAudio.volume = Math.max(0, Math.min(1, trackTarget)); } catch (e) {}
    MUS.fileTarget = trackTarget;
  }
}
function setPaused(on, silent) {
  const want = !!on;
  if (want) {
    if (S.screen !== 'playing' || P.dead || S.shopOpen || S.bossRewardOpen || S.helpOpen) return S.paused;
    if (S.paused) return true;
    S.paused = true;
    S.panel = false;
    clearGameplayInput();
    syncMusicDuck();
    if (!silent) sfx('pause');
  } else {
    if (!S.paused) return false;
    S.paused = false;
    IN.ax = 0; IN.jump = false; IN.atk = false; IN.slam = false; syncHoldInputs();
    syncMusicDuck();
    if (!silent) sfx('resume');
  }
  return S.paused;
}
function togglePause() { return setPaused(!S.paused); }
function audioVolume(value) { return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1; }
function getSoundVolume() { return audioVolume(S.meta.soundVolume); }
function getBgmVolume() { return audioVolume(S.meta.bgmVolume); }
function syncSoundVolume() {
  if (AUD.sfxBus && AUD.ctx) fadeAudioGain(AUD.sfxBus.gain, S.meta.sound === false ? 0 : getSoundVolume(), 0.04);
}
function setSoundVolume(value) {
  S.meta.soundVolume = audioVolume(value); saveMeta(); syncSoundVolume();
  return S.meta.soundVolume;
}
function setBgmVolume(value) {
  S.meta.bgmVolume = audioVolume(value); saveMeta();
  if (AUD.ctx && MUS.output) fadeAudioGain(MUS.output.gain, MUS.on && S.meta.bgm !== false ? getBgmVolume() : 0, 0.04);
  syncMusicDuck();
  return S.meta.bgmVolume;
}
function setSound(on) {
  /* 音效开关与音量仅作用于音效干湿总线，不影响音乐或其混响尾音。 */
  S.meta.sound = !!on; saveMeta(); syncSoundVolume();
  toast(on ? '音效已开启' : '音效已关闭', on ? PAL.green : PAL.mut);
}
function toggleSound() { const on = S.meta.sound === false; setSound(on); if (on) sfx('ui'); }
function setBgm(on) {
  /* 音乐开关：只控制背景音乐，与音效互不影响 */
  S.meta.bgm = !!on; saveMeta();
  if (on) { if (!AUD.ctx) audioInit(); musicStart(); }
  else musicStop();
  toast(on ? '背景音乐已开启' : '背景音乐已关闭', on ? PAL.green : PAL.mut);
}
function toggleBgm() { const on = S.meta.bgm === false; setBgm(on); if (on) sfx('ui'); }


/* ---------- 输入 ---------- */
const IN = { ax: 0, jump: false, jumpHeld: false, atk: false, atkHeld: false, slam: false, slotSwap: false, touch: false };
const keys = {};
const ptr = new Map();
function gameplayInputBlocked() {
  return S.screen !== 'playing' || P.dead || S.shopOpen || S.bossRewardOpen || S.paused || S.panel || S.helpOpen || S.settingsOpen || S.guideOpen || S.loadout || (S.training && S.trainToolsOpen);
}
function clearGameplayInput() {
  IN.ax = 0; IN.jump = false; IN.atk = false; IN.slam = false; IN.slotSwap = false;
  for (const k in keys) keys[k] = false;
  ptr.clear(); stickReset(); syncHoldInputs();
}
/* ---------- 可自定义键位绑定 + 桌面 / 手机自适应 ---------- */
const DEFAULT_BINDINGS = {
  left: ['arrowleft', 'a'], right: ['arrowright', 'd'],
  jump: ['z', ' ', 'arrowup'], attack: ['x', 'j'], slam: ['c', 'k'],
  dodge: ['shift'], slot: ['q'], weapon: ['e'], pact: ['f'],
  panel: ['p'], pause: ['escape'], help: ['h'],
};
const BIND_ORDER = ['left', 'right', 'jump', 'attack', 'slam', 'dodge', 'slot', 'weapon', 'pact', 'panel', 'pause', 'help'];
const BIND_LABELS = { left: '左移', right: '右移', jump: '跳跃', attack: '攻击', slam: '下砸', dodge: '闪避', slot: '换槽', weapon: '切武', pact: '战祭', panel: '画卷', pause: '暂停', help: '秘典' };
const BIND_DESC = { left: '向左移动', right: '向右移动', jump: '跳跃 / 二段跳', attack: '近战挥击 / 远程连射', slam: '空中下砸', dodge: '闪避短暂无敌', slot: '近战 / 远程换槽', weapon: '循环切换武器', pact: '战祭坛开战', panel: '角色画卷', pause: '暂停游戏', help: '操作说明' };
let BIND = JSON.parse(JSON.stringify(DEFAULT_BINDINGS));
const RESERVED_BINDINGS = { m: '音效开关', n: '音乐开关', g: '新手引导', t: '训练场', u: '印记解锁', r: '重新开局 / 训练重置', b: '训练 Boss', q: '暂停页返回', f: '门厅 / 训练操作', escape: '取消 / 返回' };
function bindingKeyError(action, k) {
  if (typeof k !== 'string' || !((k.length === 1 && k.charCodeAt(0) >= 32 && k.charCodeAt(0) <= 126) || ['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'shift', 'escape'].includes(k))) return '请使用普通字符键、方向键或 Shift';
  if (/^[0-9]$/.test(k)) return '数字键保留给难度、商店与训练选择';
  if (RESERVED_BINDINGS[k] && !((k === 'q' && action === 'slot') || (k === 'f' && action === 'pact') || (k === 'escape' && action === 'pause'))) return keyLabel(k) + ' 已保留给' + RESERVED_BINDINGS[k];
  return '';
}
function loadBindings() {
  BIND = JSON.parse(JSON.stringify(DEFAULT_BINDINGS));
  const mb = (S.meta && S.meta.bindings) || {};
  for (const a of BIND_ORDER) if (Array.isArray(mb[a]) && mb[a].length) {
    const valid = mb[a].filter(k => typeof k === 'string').map(k => k.toLowerCase()).filter(k => !bindingKeyError(a, k));
    if (valid.length) BIND[a] = [...new Set(valid)];
    else delete mb[a];
  }
  let conflicts;
  do {
    conflicts = BIND_ORDER.filter(a => mb[a] && bindingConflicts(a).length);
    for (const a of conflicts) { delete mb[a]; BIND[a] = [...DEFAULT_BINDINGS[a]]; }
  } while (conflicts.length);
}
function isKey(action, k) { return !!(BIND[action] && BIND[action].includes(k)); }
function assignBinding(action, k) {
  if (!BIND_ORDER.includes(action) || typeof k !== 'string') return false;
  k = k.toLowerCase();
  const conflict = BIND_ORDER.find(a => a !== action && BIND[a].includes(k));
  S.bindingError = bindingKeyError(action, k) || (conflict ? keyLabel(k) + ' 已用于「' + BIND_LABELS[conflict] + '」，请换一个键' : '');
  if (S.bindingError) return false;
  if (!S.meta.bindings || typeof S.meta.bindings !== 'object') S.meta.bindings = {};
  S.meta.bindings[action] = [k];
  loadBindings(); saveMeta();
  return true;
}
function resetBindings() { S.meta.bindings = {}; S.keyCapture = null; S.bindingError = ''; loadBindings(); saveMeta(); }
function bindingConflicts(action) {
  const mine = BIND[action] || [], out = [];
  for (const a of BIND_ORDER) if (a !== action && (BIND[a] || []).some(k => mine.includes(k))) out.push(BIND_LABELS[a]);
  return out;
}
const KEY_NAMES = { ' ': '空格', 'arrowleft': '←', 'arrowright': '→', 'arrowup': '↑', 'arrowdown': '↓', 'shift': 'Shift', 'escape': 'Esc', 'enter': 'Enter', 'tab': 'Tab', 'control': 'Ctrl', 'alt': 'Alt', 'backspace': '退格', 'capslock': 'Caps', 'meta': 'Win' };
function keyLabel(k) { return KEY_NAMES[k] || (k.length === 1 ? k.toUpperCase() : k.charAt(0).toUpperCase() + k.slice(1)); }
function bindingText(action) { return (BIND[action] || []).map(keyLabel).join(' / '); }
function bindingLabel(action) { return keyLabel(BIND[action][0]); }
/* 设备自适应：auto 以主指针类型判定（粗指针＝手机 / 平板），并记忆本会话触屏使用；可手动覆盖 */
function primaryTouch() { try { return window.matchMedia('(pointer: coarse)').matches; } catch (_) { return false; } }
let touchDetected = primaryTouch();
function useTouch() {
  const m = (S.meta && S.meta.controlMode) || 'auto';
  if (m === 'touch') return true;
  if (m === 'keyboard') return false;
  return touchDetected;
}
/* 多指或键盘＋触屏同时按住时，只有最后一个来源松开才真正释放，避免卡键或误释放 */
function syncHoldInputs() {
  let jumpTouch = false, atkTouch = false;
  for (const s of ptr.values()) {
    if ((s.kind === 'btn' && s.id === 'jump') || (s.kind === 'stick' && s.jumpHeld)) jumpTouch = true;
    if (s.kind === 'btn' && s.id === 'atk') atkTouch = true;
  }
  IN.jumpHeld = jumpTouch || BIND.jump.some(k => keys[k]);
  IN.atkHeld = atkTouch || BIND.attack.some(k => keys[k]);
}
addEventListener('keydown', e => {
  if (e.repeat) return;
  audioInit();
  const k = e.key.toLowerCase();
  if (S.keyCapture) {
    e.preventDefault();
    if (k === 'escape') { S.keyCapture = null; S.bindingError = ''; }
    else if (e.ctrlKey || e.altKey || e.metaKey || e.isComposing) S.bindingError = '不支持组合快捷键或输入法，请直接按单个键';
    else if (assignBinding(S.keyCapture, k)) { S.keyCapture = null; sfx('ui'); }
    return;
  }
  if (S.settingsOpen) {
    if (k === 'escape') { closeSettings(); }
    return;
  }
  if (e.ctrlKey || e.altKey || e.metaKey || e.isComposing) return;
  if (BIND_ORDER.some(a => isKey(a, k))) e.preventDefault();
  keys[k] = true; syncHoldInputs();
  if (k === 'm') { toggleSound(); return; }
  if (k === 'n') { toggleBgm(); return; }
  if (S.guideOpen) {
    if (k === 'escape' || k === 'enter' || k === 'g') { S.guideOpen = false; return; }
    if (k === 'arrowleft' || k === 'arrowup') { S.guidePage = Math.max(0, S.guidePage - 1); return; }
    if (k === 'arrowright' || k === 'arrowdown' || k === ' ') { S.guidePage = Math.min(3, S.guidePage + 1); return; }
    return;
  }
  if (S.helpOpen) { if (isKey('help', k) || ['escape', ' ', 'enter'].includes(k)) closeHelp(); return; }
  if (S.loadout) {
    if (k === 'escape') { cancelLoadout(); return; }
    if (k === 'enter' || k === ' ') { confirmLoadout(); return; }
    if (k === 'arrowleft') { loadoutMove(-1, 0); return; }
    if (k === 'arrowright') { loadoutMove(1, 0); return; }
    if (k === 'arrowup') { loadoutMove(0, -1); return; }
    if (k === 'arrowdown') { loadoutMove(0, 1); return; }
    if (['1', '2', '3', '4'].includes(k)) { const arr = loadoutList(S.loadout.col); if (arr[+k - 1]) { S.loadout.row = +k - 1; pickLoadout(arr[+k - 1]); } return; }
    if (k === 'tab') { e.preventDefault(); loadoutMove(1, 0); return; }
    return;
  }
  if (isKey('help', k)) { S.helpOpen = true; clearGameplayInput(); return; }
  if (S.screen === 'dead') {
    if (k === 'enter' || k === ' ') { openLoadout(S.mode, 'dead'); return; }
    if (k === 'escape') { startHall(); return; }
    return;
  }
  if (S.screen === 'menu') {
    const arr = ['endless', 'limited', 'daily'];
    if (S.menuPage === 'select') {
      if (['1', '2', '3'].includes(k)) { startRun(arr[+k - 1]); return; }
      if (k === 'escape') { S.menuPage = 'home'; return; }
      return;
    }
    if (S.menuPage === 'unlock' || S.menuPage === 'learn') {
      if (k === 'escape') { S.menuPage = 'home'; return; }
      if (S.menuPage === 'unlock') return;
    }
    if (k === 'enter' || k === ' ') { startHall(); return; }
    if (k === 't') { startTraining(); return; }
    if (k === 'u') { S.menuPage = 'unlock'; sfx('ui'); return; }
    if (k === 'g') { S.guideOpen = true; S.guidePage = 0; return; }
    return;
  }
  if (S.bossRewardOpen) {
    if (['1', '2', '3'].includes(k)) chooseBossReward(+k - 1);
    return;
  }
  if (S.shopOpen) {
    if (['1', '2', '3', '4'].includes(k)) buyOffer(+k - 1);
    if (k === ' ' || k === 'enter' || k === 'escape') S.shopOpen = false;
    return;
  }
  if (S.panel) {
    if (isKey('panel', k) || k === 'escape' || k === ' ' || k === 'enter') { S.panel = false; sfx('ui'); }
    return;
  }
  if (S.paused) {
    if (k === 'tab' && S.training) { e.preventDefault(); cycleTrainTab(); sfx('ui'); return; }
    if (isKey('pause', k) || k === 'escape' || k === ' ' || k === 'enter') { setPaused(false); return; }
    if (k === 'r') {
      setPaused(false, true);
      if (S.training) resetDummy(); else startRun(S.mode);
      return;
    }
    if (isKey('panel', k) && !S.training) { S.panel = true; clearGameplayInput(); sfx('ui'); return; }
    if (k === 'f' && S.training) { const ti = (TRAP_KINDS.indexOf(S.trainTrap) + 1) % TRAP_KINDS.length; setPaused(false, true); trainingTrap(TRAP_KINDS[ti]); return; }
    if (k === 'b' && S.training) { setPaused(false, true); trainingBoss(); return; }
    if (k === 'q') {
      if (S.training) leaveTraining();
      else { setPaused(false, true); S.screen = 'menu'; S.menuPage = 'home'; sfx('ui'); }
      return;
    }
    return;
  }
  if (S.hall) {
    if (k === 'escape') { S.hall = false; S.screen = 'menu'; S.menuPage = 'home'; sfx('ui'); return; }
    if ((k === 'r' || k === 'f') && S.hallNear >= 0) { enterHallDoor(S.hallNear); return; }
    if (['1', '2', '3', '4'].includes(k)) { setDifficulty(['easy', 'normal', 'hard', 'hell'][+k - 1]); return; }
    if (isKey('panel', k) || isKey('help', k)) return;
  }
  if (S.training) {
    if (S.trainToolsOpen && k === 'escape') { S.trainToolsOpen = false; clearGameplayInput(); return; }
    if (k === 'tab') { e.preventDefault(); cycleTrainTab(); clearGameplayInput(); sfx('ui'); return; }
    const twKeys = trainWeaponKeys();
    const num = parseInt(k, 10);
    if (S.trainTab === 'weapons' && !isNaN(num) && num >= 1 && num <= twKeys.length) {
      trainingSelect(twKeys[num - 1]);
      return;
    }
    if (['1', '2', '3', '4', '5'].includes(k) && twKeys[+k - 1]) {
      trainingSelect(twKeys[+k - 1]);
      return;
    }
    const mIdx = ['6', '7', '8', '9', '0'].indexOf(k);
    if (mIdx >= 0) { trainingSpawn(TRAIN_MONS[mIdx]); return; }
    if (k === 'f') { const ti = (TRAP_KINDS.indexOf(S.trainTrap) + 1) % TRAP_KINDS.length; trainingTrap(TRAP_KINDS[ti]); return; }
    if (k === 'b') { trainingBoss(); return; }
    if (k === 'r') { resetDummy(); return; }
    if (isKey('pause', k)) { setPaused(true); return; }
    if (S.trainToolsOpen) return;
  }
  if (isKey('jump', k)) { IN.jump = true; IN.jumpHeld = true; }
  if (isKey('attack', k)) { IN.atk = true; IN.atkHeld = true; }
  if (isKey('slam', k)) IN.slam = true;
  if (isKey('slot', k) && S.screen === 'playing' && !S.paused && !S.helpOpen) swapWeaponSlot();
  if (isKey('dodge', k)) doDodge();
  if (isKey('weapon', k)) cycleWeapon();
  if (isKey('pact', k) && !S.training) activatePact();
  if (isKey('panel', k) && !S.training) { S.panel = !S.panel; clearGameplayInput(); sfx('ui'); }
  if (isKey('pause', k)) { setPaused(true); return; }
});
addEventListener('keyup', e => {
  const k = e.key.toLowerCase(); keys[k] = false; syncHoldInputs();
});
function pauseForBackground() {
  clearGameplayInput();
  if (S.screen === 'playing' && !S.shopOpen && !S.helpOpen && !P.dead && !S.autoAttack && !S.paused) setPaused(true, true);
}
addEventListener('blur', pauseForBackground);
document.addEventListener('visibilitychange', () => { if (document.hidden) pauseForBackground(); });
function keyAxis() { return (BIND.right.some(k => keys[k]) ? 1 : 0) - (BIND.left.some(k => keys[k]) ? 1 : 0); }
const touchLayer = document.getElementById('touch-controls');
const touchKeys = [...touchLayer.querySelectorAll('[data-touch]')];
function ptrPos(e) {
  const r = cv.getBoundingClientRect();
  if (!ORIENT.forced) return { x: (e.clientX - r.left) / r.width * CFG.W, y: (e.clientY - r.top) / r.height * CFG.H };
  /* 舞台被旋转：把触点视口坐标反变换回画布坐标（此时 r 的宽高是互换的） */
  const lx = ORIENT.dir > 0 ? e.clientY - r.top : r.bottom - e.clientY;
  const ly = ORIENT.dir > 0 ? r.right - e.clientX : e.clientX - r.left;
  return { x: lx / r.height * CFG.W, y: ly / r.width * CFG.H };
}
cv.addEventListener('pointerdown', e => {
  audioInit();
  if (e.pointerType === 'touch') touchDetected = true;
  const p = ptrPos(e);
  if (S.helpOpen) { closeHelp(); return; }
  for (const h of S.hit) if (p.x >= h.x && p.x <= h.x + h.w && p.y >= h.y && p.y <= h.y + h.h) { sfx('ui'); h.act(); if (gameplayInputBlocked()) clearGameplayInput(); return; }
  if (gameplayInputBlocked()) { clearGameplayInput(); return; }
  try { cv.setPointerCapture(e.pointerId); } catch (_) {}
  IN.touch = true;
  if (p.x < CFG.W / 2) ptr.set(e.pointerId, { kind: 'move', x0: p.x, ax: 0 });
});
cv.addEventListener('pointermove', e => {
  if (gameplayInputBlocked()) { clearGameplayInput(); return; }
  const s = ptr.get(e.pointerId); if (!s) return;
  const pos = ptrPos(e);
  if (s.kind !== 'move') return;
  const curX = pos.x;
  const dx = curX - s.x0;
  const radius = 36;
  /* 动态中心牵引：手指拉出最大行程后中心点自动跟随，折返跑反向响应延迟归零 */
  if (Math.abs(dx) > radius) {
    s.x0 = curX - Math.sign(dx) * radius;
  }
  s.ax = Math.max(-1, Math.min(1, (curX - s.x0) / radius));
});
function ptrEnd(e) {
  ptr.delete(e.pointerId);
  if (stickPtr && stickPtr.id === e.pointerId) stickReset();
  syncHoldInputs();
  const target = e.currentTarget;
  try { if (target.hasPointerCapture(e.pointerId)) target.releasePointerCapture(e.pointerId); } catch (_) {}
  syncTouchButtons();
}
for (const button of touchKeys) {
  button.addEventListener('pointerdown', e => {
    e.preventDefault();
    audioInit();
    if (gameplayInputBlocked()) { clearGameplayInput(); return; }
    touchDetected = true;
    const id = button.dataset.touch;
    /* 门厅没有键盘：攻击键充当 R/F，靠近门即入门整备 */
    if (id === 'atk' && S.hall) {
      if (S.hallNear >= 0) enterHallDoor(S.hallNear);
      else toast('走近门再按「进」', PAL.mut);
      syncTouchButtons();
      return;
    }
    try { button.setPointerCapture(e.pointerId); } catch (_) {}
    ptr.set(e.pointerId, { kind: 'btn', id });
    if (id === 'atk') IN.atk = true;
    if (id === 'dodge') doDodge();
    if (id === 'weapon') cycleWeapon();
    if (id === 'slot') swapWeaponSlot();
    syncHoldInputs(); syncTouchButtons();
  });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(event, ptrEnd);
}
document.getElementById('touch-pause').addEventListener('click', () => { setPaused(true); syncNativeUI(); });
addEventListener('resize', () => { clearGameplayInput(); syncNativeUI(); });
cv.addEventListener('pointerup', ptrEnd);
cv.addEventListener('pointercancel', ptrEnd);
cv.addEventListener('lostpointercapture', ptrEnd);
/* ---------- 左侧虚拟摇杆：原点跟手指落点，横滑模拟量移动，上推跳（空中回中再推=二段跳），一根手指同时跑跳 ---------- */
const stickZone = document.getElementById('stick-zone');
const stickBase = document.getElementById('stick-base');
const stickKnob = document.getElementById('stick-knob');
/* 摇杆尺寸可在设置里调（84–176px），行程/死区/跳阈值随尺寸等比缩放，手感一致 */
const stickGeom = { half: 66, R: 34, dead: 6, jump: 26, slam: 26 };
function applyStickSize() {
  const d = Math.max(84, Math.min(176, Math.round(S.meta.stickSize || 132)));
  document.documentElement.style.setProperty('--stick-d', d + 'px');
  document.documentElement.style.setProperty('--stick-k', Math.round(d * 0.42) + 'px');
  stickGeom.half = d / 2;
  stickGeom.R = d * 0.258;
  stickGeom.dead = d * 0.045;
  stickGeom.jump = d * 0.197;
  stickGeom.slam = d * 0.197;
}
let stickPtr = null;
function stickReset() {
  if (stickPtr) ptr.delete(stickPtr.id);
  stickPtr = null;
  stickBase.classList.remove('active', 'pulse');
  stickBase.style.left = ''; stickBase.style.top = ''; stickBase.style.bottom = '';
  stickKnob.style.transform = '';
}
function stickPlaceBase(e) {
  const r = stickZone.getBoundingClientRect();
  const zw = stickZone.offsetWidth, zh = stickZone.offsetHeight;
  let lx, ly;
  if (!ORIENT.forced) { lx = e.clientX - r.left; ly = e.clientY - r.top; }
  else if (ORIENT.dir > 0) { lx = (e.clientY - r.top) * zw / r.height; ly = (r.right - e.clientX) * zh / r.width; }
  else { lx = (r.bottom - e.clientY) * zw / r.height; ly = (e.clientX - r.left) * zh / r.width; }
  const half = stickGeom.half;
  lx = Math.max(half, Math.min(zw - half, lx));
  ly = Math.max(half + 22, Math.min(zh - half, ly));
  stickBase.style.left = (lx - half) + 'px';
  stickBase.style.top = (ly - half) + 'px';
  stickBase.style.bottom = 'auto';
}
function stickUpdate(e) {
  const s = stickPtr;
  const dx = e.clientX - s.cx, dy = e.clientY - s.cy;
  const d = !ORIENT.forced ? { x: dx, y: dy } : ORIENT.dir > 0 ? { x: dy, y: -dx } : { x: -dy, y: dx };
  const len = Math.hypot(d.x, d.y);
  const k = len > stickGeom.R ? stickGeom.R / len : 1;
  stickKnob.style.transform = 'translate(' + (d.x * k).toFixed(1) + 'px,' + (d.y * k).toFixed(1) + 'px)';
  s.ax = Math.sign(d.x) * Math.max(0, Math.min(1, (Math.abs(d.x) - stickGeom.dead) / (stickGeom.R - stickGeom.dead)));
  if (d.y < -stickGeom.jump && s.armed) {
    s.armed = false;
    IN.jump = true;
    stickBase.classList.add('pulse');
    setTimeout(() => stickBase.classList.remove('pulse'), 160);
  } else if (d.y > -stickGeom.jump * 0.45) s.armed = true;
  /* 空中下推 = 下砸（键盘 C/K 的触屏映射），回中再推可再次触发 */
  if (!P.onGround && d.y > stickGeom.slam && s.slamArmed) {
    s.slamArmed = false;
    IN.slam = true;
    stickBase.classList.add('slam');
    setTimeout(() => stickBase.classList.remove('slam'), 160);
  } else if (d.y < stickGeom.slam * 0.45) s.slamArmed = true;
  s.jumpHeld = d.y < -12;
  syncHoldInputs();
}
stickZone.addEventListener('pointerdown', e => {
  e.preventDefault();
  audioInit();
  if (gameplayInputBlocked()) { clearGameplayInput(); return; }
  touchDetected = true;
  if (stickPtr) return;
  stickPtr = { kind: 'stick', id: e.pointerId, cx: e.clientX, cy: e.clientY, ax: 0, armed: true, slamArmed: true, jumpHeld: false };
  ptr.set(e.pointerId, stickPtr);
  try { stickZone.setPointerCapture(e.pointerId); } catch (_) {}
  if ((S.meta.stickOrigin || 'float') === 'fixed') {
    /* 全固定：基座留在 resting 位置，触点相对基座中心取向量 */
    const br = stickBase.getBoundingClientRect();
    stickPtr.cx = br.left + br.width / 2;
    stickPtr.cy = br.top + br.height / 2;
  } else {
    stickPlaceBase(e);
  }
  stickBase.classList.add('active');
  stickUpdate(e);
});
stickZone.addEventListener('pointermove', e => {
  if (!stickPtr || stickPtr.id !== e.pointerId) return;
  if (gameplayInputBlocked()) { clearGameplayInput(); return; }
  stickUpdate(e);
});
for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) stickZone.addEventListener(event, e => {
  if (stickPtr && stickPtr.id === e.pointerId) { ptr.delete(e.pointerId); stickReset(); syncHoldInputs(); }
});
function touchAxis() {
  let btn = 0, swipe = 0;
  for (const s of ptr.values()) {
    if (s.kind === 'stick') btn += s.ax;
    else if (s.kind === 'move' && s.ax) swipe = s.ax;
  }
  return btn !== 0 ? Math.max(-1, Math.min(1, btn)) : swipe;
}
function readInput() {
  const ka = keyAxis();
  IN.touch = useTouch() || ptr.size > 0;
  IN.ax = ka !== 0 ? ka : touchAxis();
}

/* ---------- 程序化像素美术 ---------- */
let artSeed = 7;
function arng() { artSeed |= 0; artSeed = artSeed + 0x6D2B79F5 | 0; let t = Math.imul(artSeed ^ artSeed >>> 15, 1 | artSeed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }
function mkc(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.imageSmoothingEnabled = false; return [c, g]; }
function px(g, x, y, w, h, c) { g.fillStyle = c; g.fillRect(x, y, w, h); }

const TILE = {};
function buildTile(kind) {
  const [c, g] = mkc(64, 32);
  const P = (x, y, w, h, col) => px(g, x * 2, y * 2, w * 2, h * 2, col);
  const topBase = kind === 'gate' ? PAL.gold : (kind === 'brit' ? '#633838' : PAL.stone3);
  const base = kind === 'gate' ? PAL.gold2 : (kind === 'brit' ? '#3d2428' : PAL.stone);
  /* 暗黑墓室重墨错缝条石砌体 */
  P(0, 0, 32, 16, base);
  P(0, 0, 32, 3, topBase);
  P(0, 3, 32, 2, PAL.stone2);
  P(0, 12, 32, 4, PAL.shade);
  px(g, 0, 0, 64, 2, PAL.ink);
  px(g, 0, 2, 64, 1, kind === 'gate' ? PAL.hi : PAL.stone3);
  px(g, 2, 3, 60, 1, 'rgba(244,236,220,0.22)');
  px(g, 0, 7, 64, 2, PAL.ink);
  px(g, 0, 17, 64, 2, PAL.ink);
  px(g, 0, 26, 64, 2, PAL.ink3);
  px(g, 0, 29, 64, 3, PAL.ink);
  /* 竖向重墨灰浆缝、碎角凹坑与骨白冷光倒角 */
  for (const sx of [18, 44]) {
    px(g, sx, 7, 2, 10, PAL.ink);
    px(g, sx + 2, 9, 9, 1, 'rgba(244,236,220,0.15)');
    px(g, sx - 3, 15, 3, 2, PAL.ink3);
  }
  for (const sx of [9, 32, 54]) {
    px(g, sx, 19, 2, 8, PAL.ink);
    px(g, sx + 2, 20, 6, 1, 'rgba(244,236,220,0.10)');
  }
  px(g, 3, 9, 12, 1, 'rgba(244,236,220,0.13)');
  /* 墓穴暗苔、铁铆钉与微风化凿痕 */
  if (kind !== 'gate') {
    for (let i = 0; i < 7; i++) {
      const mx = 4 + Math.floor(arng() * 54), my = 4 + Math.floor(arng() * 19);
      px(g, mx, my, 2, 1, i % 2 ? PAL.green2 : 'rgba(107,201,104,0.38)');
      if (i % 3 === 0) px(g, mx, my + 1, 1, 2, PAL.ink);
    }
    if (kind === 'norm') {
      /* 墓石侧嵌熟铁小铆钉 */
      px(g, 26, 11, 3, 3, PAL.ink); px(g, 27, 12, 1, 1, PAL.gold2);
      px(g, 52, 11, 3, 3, PAL.ink); px(g, 53, 12, 1, 1, PAL.stone3);
    }
  }
  if (kind === 'brit') {
    /* 染血危岩：凝血暗红浸渍 + 锯齿重墨裂隙网 + 剥落碎齿底缘 */
    px(g, 0, 2, 64, 28, 'rgba(224,60,49,0.14)');
    for (const [cx0, cy0, dx, len] of [[13, 2, 1, 17], [15, 16, -1, 13], [37, 3, -1, 15], [36, 15, 1, 14], [52, 7, -1, 19]]) {
      for (let s = 0; s < len; s++) {
        const xx = cx0 + Math.round(s * dx * 0.45);
        px(g, xx, cy0 + s, 2, 2, PAL.ink);
        if (s % 3 === 1) px(g, xx + 2, cy0 + s, 1, 1, PAL.red);
      }
    }
    for (const nx of [6, 20, 34, 48]) px(g, nx, 27, 6, 5, PAL.ink);
    px(g, 11, 2, 5, 2, PAL.red2); px(g, 40, 2, 6, 2, PAL.red2);
  }
  if (kind === 'bounce') {
    /* 矮人锻造炼金弹板：黑铁铆钉底匣 + 三柱淬火黄铜弹簧 + 冥翠符文冲压板 */
    P(0, 3, 32, 11, '#14111c');
    for (const sx of [10, 31, 52]) {
      px(g, sx - 3, 8, 7, 18, PAL.ink);
      for (let r = 9; r <= 23; r += 4) {
        px(g, sx - 2, r, 5, 2, PAL.gold2);
        px(g, sx - 1, r, 3, 1, PAL.gold);
      }
    }
    P(0, 0, 32, 4, PAL.green2);
    px(g, 0, 0, 64, 1, PAL.ink);
    px(g, 2, 2, 60, 4, PAL.green);
    px(g, 4, 2, 18, 1, PAL.hi); px(g, 42, 2, 14, 1, PAL.hi);
    px(g, 30, 3, 4, 1, PAL.hi); px(g, 28, 4, 8, 1, PAL.hi);
    px(g, 0, 1, 5, 8, PAL.ink); px(g, 59, 1, 5, 8, PAL.ink);
    px(g, 1, 2, 3, 6, PAL.gold2); px(g, 60, 2, 3, 6, PAL.gold2);
    px(g, 1, 2, 2, 2, PAL.gold); px(g, 60, 2, 2, 2, PAL.gold);
    px(g, 0, 26, 64, 4, PAL.gold2);
  }
  if (kind === 'gate') {
    /* 庇护圣所黑曜鎏金祭坛石 */
    px(g, 0, 6, 64, 20, '#221b30');
    px(g, 0, 24, 64, 4, PAL.gold2);
    px(g, 0, 24, 64, 1, PAL.gold);
    for (let i = 0; i < 4; i++) {
      const rx = 6 + i * 16;
      px(g, rx, 9, 8, 12, PAL.ink);
      px(g, rx + 1, 10, 6, 10, PAL.violet3);
      px(g, rx + 2, 11, 4, 8, PAL.violet2);
      px(g, rx + 3, 13, 2, 4, PAL.hi);
      px(g, rx + 11, 13, 2, 3, PAL.gold);
    }
  }
  if (kind === 'boss') {
    /* 献祭镇魔血坛砖：黑曜重墨底 + 动脉血槽 + 古铜铆钉压边 */
    px(g, 0, 1, 64, 4, PAL.red2);
    px(g, 0, 1, 64, 2, PAL.red);
    px(g, 0, 1, 64, 1, PAL.gold);
    px(g, 0, 5, 64, 21, '#1b1322');
    px(g, 0, 25, 64, 4, PAL.gold2);
    for (let i = 0; i < 4; i++) {
      const rx = 5 + i * 16;
      px(g, rx, 8, 9, 13, PAL.ink);
      px(g, rx + 1, 9, 7, 11, '#3b1722');
      px(g, rx + 3, 11, 3, 7, PAL.red);
      px(g, rx + 4, 13, 1, 3, PAL.gold);
      px(g, rx + 12, 13, 2, 2, PAL.gold2);
    }
  }
  return c;
}
['norm', 'brit', 'bounce', 'gate', 'boss'].forEach(k => TILE[k] = buildTile(k));
const WALLT = (() => {
  const [c, g] = mkc(48, 192);
  px(g, 0, 0, 48, 192, PAL.stone);
  /* 暗黑地牢重墨石壁：向光冷岩棱线 + 深渊背光阴翳带 */
  px(g, 0, 0, 6, 192, PAL.stone3);
  px(g, 40, 0, 8, 192, PAL.shade);
  px(g, 0, 0, 2, 192, PAL.ink);
  px(g, 2, 0, 1, 192, 'rgba(244,236,220,0.22)');
  px(g, 6, 0, 2, 192, PAL.ink);
  px(g, 45, 0, 3, 192, PAL.ink);
  for (let row = 0; row < 8; row++) {
    const y = row * 24;
    px(g, 0, y, 48, 2, PAL.ink);
    px(g, 2, y + 2, 40, 1, 'rgba(244,236,220,0.11)');
    px(g, 6, y + 21, 36, 3, 'rgba(9,8,12,0.52)');
    const jx = row % 2 === 0 ? 18 : 28;
    px(g, jx, y + 2, 2, 22, PAL.ink);
    px(g, jx + 2, y + 3, 1, 18, 'rgba(244,236,220,0.09)');
    px(g, jx - 2, y + 3, 2, 18, 'rgba(9,8,12,0.40)');
    /* 嵌入式锻铁刑具拉环与黄铜铆钉 */
    if (row % 2 === 1) {
      const rx = row % 4 === 1 ? 10 : 32;
      px(g, rx, y + 7, 6, 6, PAL.ink);
      px(g, rx + 1, y + 8, 4, 4, PAL.stone3);
      px(g, rx + 2, y + 9, 2, 2, PAL.gold2);
      px(g, rx + 1, y + 13, 4, 4, PAL.ink);
      px(g, rx + 2, y + 14, 2, 2, PAL.stone2);
    }
  }
  /* 渗水暗痕与地衣苔斑 */
  for (let i = 0; i < 22; i++) {
    const mx = 7 + Math.floor(arng() * 32), my = 4 + Math.floor(arng() * 182);
    px(g, mx, my, 2, 1, i % 3 === 0 ? PAL.green2 : 'rgba(9,8,12,0.55)');
    if (i % 4 === 0) px(g, mx, my + 1, 1, 4, 'rgba(9,8,12,0.45)');
  }
  return c;
})();
const BG = (() => {
  const [c, g] = mkc(360, 360);
  const P = (x, y, w, h, col) => px(g, x * 2, y * 2, w * 2, h * 2, col);
  P(0, 0, 180, 180, PAL.ink2);
  /* 远景古墓石砖错缝与风化剥落暗斑 */
  for (let by = 8; by < 360; by += 18) {
    px(g, 0, by, 360, 2, 'rgba(9,8,12,0.62)');
    px(g, 0, by + 2, 360, 1, 'rgba(244,236,220,0.025)');
    for (let bx = ((by / 18) % 2) * 24; bx < 360; bx += 48) {
      px(g, bx, by, 2, 18, 'rgba(9,8,12,0.46)');
    }
  }
  /* 墙面陈旧裂纹 */
  for (const [cx0, cy0, dx] of [[46, 20, 1], [172, 190, -1], [292, 36, 1]]) {
    for (let s = 0; s < 22; s++) px(g, cx0 + Math.round(s * dx * 0.4), cy0 + s, 1, 2, PAL.ink);
  }
  /* 三列哥特尖拱骸骨壁龛（Ossuary Alcoves）与铁栅幽月高窗 */
  const drawTinySkull = (sx0, sy0) => {
    px(g, sx0 - 3, sy0 - 4, 6, 5, PAL.ink);
    px(g, sx0 - 2, sy0 - 3, 4, 3, '#6e6459');
    px(g, sx0 - 2, sy0 - 3, 2, 1, '#9c8f7e');
    px(g, sx0 - 2, sy0 - 1, 1, 1, PAL.ink);
    px(g, sx0 + 1, sy0 - 1, 1, 1, PAL.ink);
    px(g, sx0 - 1, sy0, 2, 1, '#574e46');
  };
  for (let i = 0; i < 3; i++) {
    const x = 10 + i * 60;
    /* 壁柱扶壁与重墨券框 */
    P(x, 42, 40, 126, PAL.ink3);
    px(g, x * 2 - 2, 84, 84, 252, 'rgba(9,8,12,0.35)');
    P(x + 2, 40, 36, 4, PAL.stone);
    P(x - 1, 164, 42, 5, PAL.stone);
    P(x + 5, 46, 30, 118, '#0d0b12');
    /* 阶梯哥特尖拱券顶与雕花拱心石 */
    P(x + 8, 43, 24, 3, '#0d0b12');
    P(x + 12, 40, 16, 3, '#0d0b12');
    P(x + 17, 36, 6, 5, PAL.ink);
    P(x + 18, 37, 4, 4, PAL.stone2);
    /* 铁栅幽冥高窗（冥青冷月透射 + 熟铁尖刺窗棂） */
    const wx = (x + 12) * 2, wy = 106, ww = 32, wh = 68;
    px(g, wx - 2, wy - 4, ww + 4, wh + 8, PAL.ink);
    px(g, wx + 4, wy - 8, ww - 8, 4, PAL.ink);
    px(g, wx, wy, ww, wh, 'rgba(72,201,176,0.11)');
    px(g, wx + 4, wy - 6, ww - 8, 6, 'rgba(72,201,176,0.15)');
    px(g, wx + 2, wy + 2, ww - 4, 22, 'rgba(244,236,220,0.05)');
    /* 铁栅栏竖条与横锁 */
    for (const bx0 of [7, 15, 23]) px(g, wx + bx0, wy - 5, 2, wh + 5, PAL.ink);
    px(g, wx, wy + 22, ww, 2, PAL.ink);
    px(g, wx, wy + 46, ww, 2, PAL.ink);
    px(g, wx, wy, ww, 1, 'rgba(72,201,176,0.34)');
    /* 窗台挑檐 */
    px(g, wx - 4, wy + wh + 2, ww + 8, 5, PAL.ink);
    px(g, wx - 3, wy + wh + 3, ww + 6, 3, PAL.stone);
    px(g, wx - 3, wy + wh + 3, ww + 6, 1, 'rgba(244,236,220,0.15)');
    /* 壁龛底部骸骨祭坛（堆叠古墓骷髅与残烛） */
    const oy = 322, ox = (x + 6) * 2;
    px(g, ox, oy, 56, 6, PAL.ink);
    px(g, ox + 2, oy + 1, 52, 3, PAL.stone);
    drawTinySkull(ox + 12, oy);
    drawTinySkull(ox + 22, oy);
    drawTinySkull(ox + 17, oy - 4);
    drawTinySkull(ox + 42, oy);
    /* 龛角残红蜡烛 */
    px(g, ox + 32, oy - 5, 3, 5, '#c9b89c');
    px(g, ox + 33, oy - 8, 2, 3, PAL.gold);
    px(g, ox + 33, oy - 7, 1, 1, PAL.hi);
    /* 壁龛内壁砖缝与立柱冷光边 */
    for (let yy = 52; yy < 158; yy += 12) px(g, (x + 5) * 2, yy * 2, 60, 1, 'rgba(9,8,12,0.58)');
    px(g, (x + 5) * 2, 46 * 2, 1, 118 * 2, 'rgba(244,236,220,0.06)');
    px(g, (x + 34) * 2, 46 * 2, 2, 118 * 2, 'rgba(9,8,12,0.65)');
  }
  /* 横贯承重墓室石梁与黄铜铆钉牛腿托臂 */
  P(0, 31, 180, 7, PAL.ink);
  px(g, 0, 64, 360, 10, PAL.ink3);
  px(g, 0, 64, 360, 2, PAL.stone);
  px(g, 0, 64, 360, 1, 'rgba(244,236,220,0.13)');
  px(g, 0, 74, 360, 3, PAL.ink);
  for (let cx0 = 16; cx0 < 360; cx0 += 60) {
    px(g, cx0 - 1, 76, 14, 7, PAL.ink);
    px(g, cx0, 76, 12, 5, PAL.stone);
    px(g, cx0 + 2, 82, 8, 4, PAL.ink3);
    px(g, cx0 + 5, 68, 2, 2, PAL.gold2);
  }
  /* 悬垂熟铁锁链与中列悬挂铁囚笼剪影 */
  for (const [idx, lx] of [[0, 80], [1, 200], [2, 320]]) {
    const chainLen = idx === 1 ? 66 : 96;
    for (let cy0 = 0; cy0 < chainLen; cy0 += 6) {
      px(g, lx - 1, cy0, 5, 5, PAL.ink);
      px(g, lx, cy0, 3, 4, PAL.stone2);
      px(g, lx + 1, cy0 + 1, 1, 2, PAL.ink);
    }
    if (idx === 1) {
      /* 悬挂铁刑笼剪影 */
      const cgx = lx - 8, cgy = 66;
      px(g, cgx, cgy, 19, 24, PAL.ink);
      px(g, cgx + 1, cgy + 1, 17, 2, PAL.stone2);
      px(g, cgx + 1, cgy + 21, 17, 2, PAL.stone2);
      for (let b = 2; b <= 16; b += 4) px(g, cgx + b, cgy + 3, 1, 18, PAL.stone);
      drawTinySkull(cgx + 10, cgy + 20);
    }
  }
  /* 壁柱铸铁火炬托架（熏黑烟痕 + 铁碗，动态火焰在 render 中实时点亮） */
  for (const sx of [60, 180, 300]) {
    const sy0 = 238;
    px(g, sx - 6, sy0 - 22, 12, 16, 'rgba(9,8,12,0.45)');
    px(g, sx - 14, sy0 - 14, 28, 28, 'rgba(235,179,75,0.06)');
    px(g, sx - 7, sy0 - 7, 14, 14, 'rgba(224,60,49,0.10)');
    px(g, sx - 4, sy0 - 3, 8, 3, PAL.ink);
    px(g, sx - 3, sy0 - 2, 6, 2, PAL.stone3);
    px(g, sx - 2, sy0, 4, 8, PAL.ink);
    px(g, sx - 1, sy0, 2, 6, PAL.gold2);
  }
  return c;
})();

const JAG = Array.from({ length: 48 }, () => Math.floor(arng() * 6));

function seg(g, x1, y1, x2, y2, w, c) {
  const dx = x2 - x1, dy = y2 - y1, n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
  for (let i = 0; i <= n; i++) px(g, Math.round(x1 + dx * i / n) - (w >> 1), Math.round(y1 + dy * i / n) - (w >> 1), w, w, c);
}
/* ---------- 楼段环境主题（区域级，非逐层）----------
   每 10 层一个区域，恰好与门界/Boss 节点对齐。复用同一套 BG 几何与台阶/危险视觉规则，
   仅换色温罩、火把光源色、火星/浮尘粒子色三项即可让玩家不读层数也认出新区。无新增 rng。 */
const REGIONS = [
  { name: '古墓前庭', veil: 'rgba(12,9,16,0.16)', glowA: '235,179,75', glowB: '224,60,49', flame1: PAL.red, flame2: PAL.gold, ember: 'rgba(235,179,75,0.42)', dust: 'rgba(244,236,220,0.16)' },
  { name: '幽冥寒窟', veil: 'rgba(8,16,26,0.20)', glowA: '96,180,235', glowB: '72,201,176', flame1: PAL.cyan, flame2: '#bfe9ff', ember: 'rgba(110,200,235,0.42)', dust: 'rgba(180,220,240,0.16)' },
  { name: '血咒深渊', veil: 'rgba(24,8,10,0.20)', glowA: '235,90,60', glowB: '180,30,40', flame1: PAL.red, flame2: '#ff9a6a', ember: 'rgba(235,90,70,0.45)', dust: 'rgba(240,180,170,0.14)' },
  { name: '苔藓遗殿', veil: 'rgba(8,18,12,0.20)', glowA: '120,210,130', glowB: '70,150,90', flame1: PAL.green, flame2: '#d6ffb0', ember: 'rgba(120,210,130,0.40)', dust: 'rgba(180,230,190,0.15)' },
  { name: '星陨祭坛', veil: 'rgba(16,8,26,0.20)', glowA: '180,130,240', glowB: '120,80,200', flame1: PAL.violet, flame2: '#ecd6ff', ember: 'rgba(180,130,240,0.42)', dust: 'rgba(210,190,245,0.16)' },
];
function regionIndex(floor) { return Math.floor(Math.max(0, floor) / 10); }
function regionTheme(floor) { const n = REGIONS.length; return REGIONS[(regionIndex(floor) % n + n) % n]; }
/* ---------- 统一角色 / 怪物 / Boss 像素规范（仅视觉，不改判定·锚点·弹性缩放） ----------
   描边统一 PAL.ink；光源固定左上；高光封顶 UNIT_HI 避免过曝；脚底接触投影 unitShadow
   为扁平像素阴影（无发光）。UNIT_FOOT/BOSS_FOOT 仅记录投影锚点偏移与宽度，不参与命中盒。 */
const UNIT_HI = '#e7dcc6';                 /* 高光上限：略低于 PAL.hi，统一不过曝 */
const UNIT_LIT = 'rgba(244,236,220,0.26)'; /* 顶部受光边（左上光源，限亮） */
function unitShadow(g, x, footY, w, a) {
  px(g, Math.round(x - w / 2), Math.round(footY), Math.round(w), 2, 'rgba(0,0,0,' + (a === undefined ? 0.34 : a) + ')');
}
function unitLitTop(g, x, y, w) {
  px(g, Math.round(x), Math.round(y), Math.round(w), 1, UNIT_LIT);
}
/* [脚底偏移(相对绘制中心 y), 投影宽, 透明度]：地面怪浓、悬浮怪淡；dummy 自带投影故不列 */
const UNIT_FOOT = {
  crawl: [10, 26, 0.34], raider: [15, 22, 0.34], grenadier: [13, 20, 0.34],
  wisp: [13, 16, 0.18], moth: [12, 18, 0.18], bomber: [12, 16, 0.18], sniper: [15, 18, 0.18], turret: [11, 12, 0.16],
};
const BOSS_FOOT = { colossus: [50, 64, 0.22], shura: [26, 32, 0.34], lantern: [31, 36, 0.20], ocular: [27, 40, 0.20], heart: [50, 60, 0.28] };
function drawCrossLegs(g, X, feetY, dir, phase, amp, lift) {
  const hipY = feetY - 20;
  const ph = phase * Math.PI * 2;
  const A = { x: X + dir * Math.sin(ph) * amp, y: feetY - Math.max(0, Math.sin(ph + Math.PI / 2)) * lift / 10 };
  const B = { x: X + dir * Math.sin(ph + Math.PI) * amp, y: feetY - Math.max(0, Math.sin(ph + Math.PI + Math.PI / 2)) * lift / 10 };
  const kneeA = { x: (X + A.x) / 2 + dir * 3, y: (hipY + A.y) / 2 - (A.y < feetY - 2 ? 3 : 1) };
  const kneeB = { x: (X + B.x) / 2 + dir * 3, y: (hipY + B.y) / 2 - (B.y < feetY - 2 ? 3 : 1) };
  const cross = Math.sign(A.x - X) * Math.sign(B.x - X) < 0;
  const drawLeg = (hipX, knee, foot, color) => {
    seg(g, hipX, hipY, knee.x, knee.y, 4, PAL.ink);
    seg(g, knee.x, knee.y, foot.x, foot.y, 4, PAL.ink);
    seg(g, hipX, hipY, knee.x, knee.y, 2, color);
    seg(g, knee.x, knee.y, foot.x, foot.y, 2, color);
    /* 护膝金扣与绑腿受光点 */
    px(g, Math.round(knee.x) - 1, Math.round(knee.y) - 1, 2, 2, PAL.gold2);
    const n = Math.max(1, Math.abs(Math.round(foot.y - hipY)));
    for (let i = 0; i < n; i += 3) {
      const xx = hipX + (foot.x - hipX) * i / n, yy = hipY + (foot.y - hipY) * i / n;
      px(g, Math.round(xx) + 1, Math.round(yy), 1, 1, PAL.stone3);
    }
    const fx0 = Math.round(foot.x), fy0 = Math.round(foot.y);
    px(g, fx0 - 4, fy0 - 2, 9, 5, PAL.ink);
    px(g, fx0 - 3, fy0 - 1, 7, 3, PAL.shade);
    px(g, fx0 - 3, fy0 + 1, 7, 1, '#5a3e2b');
    px(g, fx0 + (dir > 0 ? 1 : -3), fy0 - 1, 2, 1, PAL.stone3);
  };
  const liftedA = A.y < B.y;
  if (cross && liftedA) { drawLeg(X - 3, kneeB, B, PAL.shade); drawLeg(X + 3, kneeA, A, PAL.violet3); }
  else if (cross) { drawLeg(X + 3, kneeA, A, PAL.shade); drawLeg(X - 3, kneeB, B, PAL.violet3); }
  else { drawLeg(X - 3, kneeA, A, PAL.shade); drawLeg(X + 3, kneeB, B, PAL.shade); }
}
function drawBackWeapon(g, cx0, top, dir, leanShift, st) {
  const meleeKey = (P.weapon && P.weapon.melee) ? P.weapon.melee : 'knife';
  const inMelee = P.slot === 0;
  const ls = Math.round(leanShift || 0);
  const shT = P.sheatheT || 0, drT = P.drawWeapT || 0;
  g.save();
  g.translate(cx0, top);
  if (dir < 0) g.scale(-1, 1);
  if (meleeKey === 'long') {
    /* 后背斜挎太刀漆鞘：金鲤口 + 朱红下绪绑绳 + 铛部金包角 */
    const sx1 = -2 + ls, sy1 = 20, sx2 = -19 + Math.round(ls * 0.4), sy2 = 33;
    seg(g, sx1, sy1, sx2, sy2, 4, PAL.ink);
    seg(g, sx1, sy1, sx2 + 1, sy2 - 1, 2, PAL.violet3);
    seg(g, sx1 - 2, sy1 + 1, sx2 + 3, sy2 - 2, 1, PAL.violet);
    px(g, sx1 - 1, sy1 - 1, 3, 2, PAL.gold2);
    px(g, Math.round((sx1 + sx2) * 0.45), Math.round((sy1 + sy2) * 0.45), 3, 2, PAL.red);
    px(g, sx2 - 1, sy2 - 1, 3, 3, PAL.gold);
    px(g, sx2, sy2, 2, 2, PAL.gold2);
    /* 当切在远程槽，或近战未在收刀前半段（sheatheT <= 0.09）时，长刀柄露于左后肩上方 */
    if (!inMelee || shT <= 0.09) {
      const slide = (inMelee && shT > 0) ? Math.round((shT / 0.09) * 5) : 0;
      const drawOut = (inMelee && drT > 0) ? 2 : (inMelee ? 1 : 0);
      const gx = -7 + ls - slide - drawOut, gy = 11 - slide - drawOut;
      const hx = gx - 9, hy = gy - 8;
      if (drawOut > 0 || slide > 0) {
        seg(g, -4 + ls, 14, gx, gy, 3, PAL.ink);
        seg(g, -4 + ls, 14, gx, gy, 1, PAL.hi);
      }
      seg(g, gx, gy, hx, hy, 4, PAL.ink);
      seg(g, gx, gy, hx, hy, 2, PAL.ink3);
      /* 菱形柄卷目贯与金兜金（柄头） */
      px(g, gx - 3, gy - 3, 2, 1, PAL.gold);
      px(g, gx - 5, gy - 5, 2, 1, PAL.red);
      px(g, gx - 7, gy - 7, 2, 1, PAL.gold);
      px(g, hx - 2, hy - 2, 4, 4, PAL.ink);
      px(g, hx - 1, hy - 1, 2, 2, PAL.gold);
      /* 圆形雕花刀镡（护手） */
      px(g, gx - 2, gy - 2, 5, 5, PAL.ink);
      px(g, gx - 1, gy - 1, 3, 3, PAL.gold);
      px(g, gx, gy, 1, 1, PAL.hi);
      if ((inMelee && shT > 0 && shT <= 0.09) || (inMelee && drT > 0.06)) {
        px(g, gx - 5, gy, 11, 1, PAL.hi);
        px(g, gx, gy - 5, 1, 11, PAL.cyan);
        px(g, gx - 1, gy - 1, 3, 3, UNIT_HI);
      }
    }
  } else if (meleeKey === 'hammer') {
    if (!inMelee || shT <= 0.09) {
      const wob = (st === 'run' || st === 'walk') ? Math.round(Math.sin(S.t * 14) * 1.2) : (P.landT > 0 ? 1 : 0);
      const slide = (inMelee && shT > 0) ? Math.round((shT / 0.09) * 4) : 0;
      const mx = -9 + ls, my = 10 + wob - slide;
      const hx2 = -19 + Math.round(ls * 0.4), hy2 = 33;
      /* 斜穿后背的缠革长木柄与金箍柄尾 */
      seg(g, mx, my, hx2, hy2, 4, PAL.ink);
      seg(g, mx, my, hx2 + 1, hy2 - 1, 2, '#9c6638');
      px(g, Math.round((mx + hx2) * 0.5), Math.round((my + hy2) * 0.5), 2, 2, '#d9b87a');
      px(g, hx2 - 1, hy2 - 1, 4, 4, PAL.ink);
      px(g, hx2, hy2, 2, 2, PAL.gold);
      /* 八棱倒角重战锤头 + 黄金铭文箍带 + 顶铆钉 */
      seg(g, mx - 5, my - 3, mx + 4, my + 2, 9, PAL.ink);
      seg(g, mx - 4, my - 2, mx + 3, my + 1, 6, PAL.stone2);
      seg(g, mx - 4, my - 3, mx + 2, my, 3, PAL.stone3);
      seg(g, mx - 4, my - 3, mx + 1, my - 1, 1, PAL.hi);
      seg(g, mx - 1, my + 2, mx + 1, my - 3, 2, PAL.gold);
      px(g, mx - 6, my - 4, 2, 3, PAL.stone3);
      px(g, mx + 4, my + 1, 2, 3, PAL.stone);
      px(g, mx, my - 2, 1, 1, PAL.hi);
    }
  } else if (meleeKey === 'ember') {
    /* 烬铁巨剑：斜跨肩后的霸气重剑（粗链条斜束 + 恶魔角十字护手 + 焦黑阔刃 + 熔岩血槽脉动微光） */
    const bx1 = -2 + ls, by1 = 8;
    /* 束缚铁链 */
    seg(g, bx1 - 4, by1 + 8, bx1 + 4, by1 + 14, 2, PAL.stone3);
    px(g, bx1 - 1, by1 + 10, 2, 2, PAL.gold2);
    /* 剑体统一绘制：护手落在肩后，阔刃斜垂至后腰 */
    g.save();
    g.translate(bx1, by1);
    g.rotate(2.18);
    emberBlade(g, 34, 0.8);
    g.restore();
    /* 剑尖偶尔飘散微小余烬 */
    if (!inMelee && (S.frames % 18 < 6)) {
      const sp = Math.round(bx1 + Math.cos(2.18) * 34), sq = Math.round(by1 + Math.sin(2.18) * 34);
      px(g, sp + (S.frames % 3) - 1, sq + 1, 1, 1, PAL.gold);
      px(g, sp - 2, sq, 1, 1, PAL.red);
    }
  } else {
    /* 短刀皮鞘斜挂后腰：铜鞘口 + 鞘尖包铁 */
    const kx1 = -4 + Math.round(ls * 0.5), ky1 = 25, kx2 = -14 + Math.round(ls * 0.3), ky2 = 30;
    seg(g, kx1, ky1, kx2, ky2, 4, PAL.ink);
    seg(g, kx1, ky1, kx2 + 1, ky2, 2, PAL.stone2);
    px(g, kx1 - 1, ky1 - 1, 2, 2, PAL.gold2);
    px(g, kx2 - 1, ky2 - 1, 2, 2, PAL.stone3);
    if (!inMelee) {
      px(g, kx1, ky1 - 2, 4, 3, PAL.ink);
      px(g, kx1 + 1, ky1 - 1, 3, 2, PAL.gold);
      px(g, kx1 + 2, ky1 - 1, 1, 1, PAL.hi);
    }
  }
  /* 若当前切在近战槽且拥有连弩，后腰侧挂载备用复合轻弩 */
  if (inMelee && P.weapon && P.weapon.ranged === 'crossbow') {
    const bx0 = -10 + Math.round(ls * 0.4);
    px(g, bx0, 21, 8, 5, PAL.ink);
    px(g, bx0 + 1, 22, 6, 3, '#9c6638');
    px(g, bx0, 20, 3, 7, PAL.ink);
    px(g, bx0 + 1, 21, 1, 5, PAL.gold);
    px(g, bx0 + 5, 22, 2, 1, PAL.cyan);
  }
  g.restore();
}

/* ---------- 烬铁巨剑专属动作：复用铁锤重击 AI 四帧作身体（原画风），叠加巨剑与熔火特效 ---------- */
const EMBER_SWING = [
  { hx: 23, hy: -36, ang: -1.95, len: 46 },  /* F0 过肩蓄势 */
  { hx: 3,  hy: -26, ang: 0.88,  len: 46 },  /* F1 破空重扫 */
  { hx: -5, hy: -21, ang: 1.02,  len: 40 },  /* F2 砸地裂石 */
  { hx: 12, hy: -30, ang: -2.18, len: 42 },  /* F3 收势回肩 */
];
function drawHeroEmberAttack(g, X, Y, anim, face, dir, sx0, sy0) {
  if (ATK_READY.hammer < 4) return false;
  const dur = anim.atkDur || 0.44;
  const prog = Math.max(0, Math.min(1, 1 - anim.atk / dur));
  const fi = prog < 0.20 ? 0 : prog < 0.48 ? 1 : prog < 0.78 ? 2 : 3;
  const offs = [0, 3, 2, 0][fi];
  const ssx = sx0 * (fi === 1 ? 1.04 : fi === 2 ? 1.02 : 1);
  const ssy = sy0 * (fi === 1 ? 0.96 : 1);
  if (!drawHeroAI(g, X, Y, fi, face, 0, ATK_IMGS.hammer, null, dir * offs, ssx, ssy)) return false;
  const feetY = Math.round(Y) + Math.round(P.h / 2);
  const cx0 = Math.round(X) + dir * offs;
  const A = EMBER_SWING[fi];
  g.save();
  g.translate(cx0, feetY);
  g.scale(face < 0 ? -ssx : ssx, ssy);
  /* 蓄力热浪 */
  if (fi === 0) {
    const pl = 0.5 + 0.5 * Math.sin(S.t * 13);
    g.fillStyle = 'rgba(224,60,49,' + (0.07 + 0.05 * pl).toFixed(2) + ')';
    g.fillRect(A.hx - 16, A.hy - 14, 32, 28);
  }
  /* 巨剑叠绘（锚在双手） */
  g.save();
  g.translate(A.hx, A.hy);
  g.rotate(A.ang);
  if (fi >= 1) emberHeat(g, A.len, fi === 2 ? 0.16 : 0.11);
  else emberHeat(g, A.len, 0.09 + 0.04 * Math.sin(S.t * 12));
  emberBlade(g, A.len, fi * 0.35);
  g.restore();
  /* 逐帧余烬 / 火星 / 碎石 */
  if (fi === 0) {
    for (let i = 0; i < 6; i++) {
      const ph = (S.t * 2.6 + i * 0.17) % 1;
      const d = A.len * (0.30 + ph * 0.62);
      const x = A.hx + Math.round(Math.cos(A.ang) * d + (i % 2 ? 2 : -2));
      const y = A.hy + Math.round(Math.sin(A.ang) * d + (i % 3 - 1));
      px(g, x, y, 1, 1, i % 2 ? PAL.gold : PAL.red);
    }
    px(g, A.hx - 1, A.hy - 1, 3, 3, PAL.hi);
  } else if (fi === 1) {
    for (let i = 0; i < 5; i++) {
      const d = A.len * (0.45 + i * 0.11);
      const x = A.hx + Math.round(Math.cos(A.ang) * d) - Math.round(Math.sin(A.ang) * (i - 2) * 2);
      const y = A.hy + Math.round(Math.sin(A.ang) * d) + Math.round(Math.cos(A.ang) * (i - 2) * 2);
      px(g, x, y, 2, 1, i < 2 ? PAL.hi : PAL.gold);
    }
  } else if (fi === 2) {
    const tx = A.hx + Math.round(Math.cos(A.ang) * A.len);
    const ty = A.hy + Math.round(Math.sin(A.ang) * A.len);
    for (let i = 0; i < 9; i++) {
      const a = -0.4 + i * 0.22;
      const d = 4 + (i * 5) % 13;
      px(g, tx + Math.round(Math.cos(a) * d), Math.max(0, ty + Math.round(Math.sin(a) * d * 0.6)), 2, 2, i % 3 ? PAL.stone3 : PAL.gold);
    }
    px(g, tx - 3, -2, 8, 3, PAL.hi);
    g.fillStyle = 'rgba(235,179,75,0.20)';
    g.fillRect(tx - 14, -10, 28, 12);
  } else {
    for (let i = 0; i < 4; i++) {
      const ph = (S.t * 1.4 + i * 0.24) % 1;
      px(g, A.hx + 6 + i * 6, A.hy - 8 - Math.round(ph * 10), 1, 1, i % 2 ? PAL.gold : PAL.stone3);
    }
  }
  g.restore();
  return true;
}

/* ---------- 烬铁巨剑：统一剑体绘制（手持/背负/挥砍共用，只用 px/seg 保持像素硬边） ----------
   局部坐标：+x 为刃向，原点在护手中心。焦铁阔刃 + 锯齿剑背 + 熔岩血槽 + 恶魔角十字护手。 */
function emberBlade(g, len, heat) {
  const L = Math.max(14, Math.round(len));
  const hot = 0.55 + 0.45 * Math.sin(S.t * 6.2 + (heat || 0) * 2.7);
  /* 剑身黑墨衬底（阔刃分段收窄 + 剑尖） */
  seg(g, 0, 0, L * 0.58, 0, 15, PAL.ink);
  seg(g, L * 0.58, 0, L * 0.84, 0, 11, PAL.ink);
  seg(g, L * 0.84, 0, L - 1, 0, 5, PAL.ink);
  /* 焦铁剑身与磨亮刃面 */
  seg(g, 1, 0, L * 0.57, 0, 11, PAL.stone2);
  seg(g, L * 0.57, 0, L * 0.83, 0, 7, PAL.stone2);
  seg(g, L * 0.83, 0, L * 0.94, 0, 3, PAL.stone3);
  /* 刃口一线白 + 剑脊暗线 */
  seg(g, 2, 4, L * 0.86, 4, 1, PAL.hi);
  seg(g, 2, -5, L * 0.78, -5, 1, PAL.ink3);
  /* 熔岩血槽：暗红底 + 呼吸金芯 */
  seg(g, 3, -1, L * 0.75, -1, 3, '#8e2a18');
  seg(g, 3, -1, L * 0.72, -1, 1, hot > 0.6 ? PAL.gold : '#c85a24');
  /* 锯齿剑背（缺口）+ 剑尖倒钩 */
  px(g, Math.round(L * 0.34), -7, 3, 4, PAL.ink);
  px(g, Math.round(L * 0.56), -6, 3, 3, PAL.ink);
  px(g, Math.round(L * 0.70), -5, 2, 3, PAL.ink);
  px(g, L - 2, 1, 2, 2, hot > 0.7 ? PAL.hi : PAL.stone3);
  /* 恶魔角十字护手（垂直刃向，两端翘角） */
  seg(g, 0, -9, 0, 9, 4, PAL.ink);
  seg(g, 0, -8, 0, 8, 2, PAL.gold2);
  px(g, 0, -10, 2, 3, PAL.stone3); px(g, 0, 7, 2, 3, PAL.stone3);
  px(g, -1, -10, 1, 1, PAL.gold); px(g, -1, 9, 1, 1, PAL.gold);
  /* 熔心宝石 */
  px(g, 1, -2, 3, 4, PAL.ink); px(g, 2, -1, 2, 2, PAL.red); px(g, 2, -1, 1, 1, PAL.hi);
  /* 缠革剑柄 + 金箍 + 八角配重 */
  seg(g, -13, 0, -1, 0, 5, PAL.ink);
  seg(g, -12, 0, -2, 0, 3, '#4a251a');
  px(g, -10, -1, 2, 3, PAL.gold2); px(g, -6, -1, 2, 3, PAL.gold2);
  px(g, -15, -2, 4, 5, PAL.ink); px(g, -14, -1, 2, 3, PAL.gold2); px(g, -13, 0, 1, 1, PAL.gold);
}
/* 刃身热浪背光（软光，只在挥砍/蓄力时给） */
function emberHeat(g, len, a) {
  g.fillStyle = 'rgba(224,60,49,' + a.toFixed(2) + ')';
  g.fillRect(-6, -10, len + 12, 20);
  g.fillStyle = 'rgba(235,179,75,' + (a * 0.7).toFixed(2) + ')';
  g.fillRect(2, -5, len * 0.8, 10);
}
function drawFrontWeapon(g, hx, hy, dir, st) {
  const inMelee = P.slot === 0;
  const meleeKey = (P.weapon && P.weapon.melee) ? P.weapon.melee : 'knife';
  const rangedKey = (P.weapon && P.weapon.ranged) ? P.weapon.ranged : 'crossbow';
  const shT = P.sheatheT || 0, drT = P.drawWeapT || 0;
  g.save();
  g.translate(Math.round(hx), Math.round(hy));
  if (dir < 0) g.scale(-1, 1);
  if (inMelee) {
    if (meleeKey === 'knife') {
      if (shT > 0) {
        /* 短刀收招挽刀花旋回反手握持位 */
        const u = Math.min(1, shT / 0.22);
        const ang = (1 - u) * 2.35 + 0.15;
        const bx = Math.round(Math.cos(ang) * 11), by = Math.round(Math.sin(ang) * 8);
        seg(g, 0, 0, bx, by, 3, PAL.ink);
        seg(g, 0, 0, bx, by, 1, PAL.hi);
        px(g, -2, -2, 3, 3, PAL.gold);
      } else {
        /* 刺客反手握短刀：金柄头 + 护手挡格 + 双色调冷冽青白短刃 */
        px(g, 2, -2, 4, 4, PAL.ink);
        px(g, 3, -1, 2, 2, PAL.gold);
        px(g, 0, -2, 2, 5, PAL.gold2);
        seg(g, -1, 2, -13, 8, 4, PAL.ink);
        seg(g, -1, 2, -12, 7, 2, PAL.cyan2);
        seg(g, -2, 3, -13, 8, 1, PAL.hi);
        px(g, -13, 8, 2, 1, UNIT_HI);
      }
    } else if (meleeKey === 'long' && shT > 0.09) {
      /* 长刀收招前半段：从身前斜下提刀翻转回后背 */
      const u = Math.min(1, (shT - 0.09) / 0.13);
      const tx = Math.round(18 * u - 12 * (1 - u)), ty = Math.round(8 * u - 16 * (1 - u));
      seg(g, 0, 0, tx, ty, 3, PAL.ink);
      seg(g, 0, 0, tx, ty, 1, PAL.hi);
      px(g, -2, -2, 4, 3, PAL.gold);
    } else if (meleeKey === 'hammer' && shT > 0.09) {
      /* 铁锤收招前半段：从前上方扛回后肩 */
      const u = Math.min(1, (shT - 0.09) / 0.13);
      const tx = Math.round(12 * u - 8 * (1 - u)), ty = Math.round(-8 * u - 14 * (1 - u));
      seg(g, -2, 2, tx, ty, 3, '#9c6638');
      px(g, tx - 5, ty - 4, 10, 8, PAL.ink);
      px(g, tx - 4, ty - 3, 8, 6, PAL.stone3);
      px(g, tx - 1, ty - 3, 2, 6, PAL.gold);
    } else if (meleeKey === 'ember') {
      /* 烬铁巨剑：双手拖刃狂战士架势（反扣剑柄 + 重剑大倾角斜拖近地 + 熔岩剑脊热浪火星） */
      if (shT > 0.09) {
        const u = Math.min(1, (shT - 0.09) / 0.13);
        const tx = Math.round(16 * u - 12 * (1 - u)), ty = Math.round(8 * u - 18 * (1 - u));
        seg(g, 0, 0, tx, ty, 6, PAL.ink);
        seg(g, 0, 0, tx, ty, 3, PAL.stone2);
        px(g, -2, -2, 5, 4, PAL.gold);
      } else {
        /* 双手紧握处与护手 */
        px(g, -3, -5, 5, 10, PAL.ink); px(g, -2, -4, 3, 8, '#4a251a');
        px(g, -3, -6, 2, 2, PAL.gold2);
        g.save();
        g.translate(3, -2);
        g.rotate(0.60);
        emberHeat(g, 30, 0.08 + 0.03 * Math.sin(S.t * 5.2));
        emberBlade(g, 30, 0.5);
        g.restore();
        /* 拖地热浪：剑尖偶发火星与地面余温 */
        if ((S.frames % 12) < 4) {
          const sp = Math.round(Math.cos(0.60) * 30) + 3, sq = Math.round(Math.sin(0.60) * 30) - 2;
          px(g, sp + (S.frames % 3), sq, 1, 1, PAL.hi);
          px(g, sp - 2, sq + 2, 1, 1, PAL.gold);
        }
      }
    }
  } else {
    if (rangedKey === 'crossbow') {
      const ry = shT > 0 ? -Math.round((shT / 0.22) * 3) : 0;
      /* 复合木托 + 扳机护圈 + 弧形铜弩臂 + 张紧弦 + 待发羽箭 */
      px(g, -3, -2 + ry, 14, 5, PAL.ink);
      px(g, -2, -1 + ry, 11, 3, '#9c6638');
      px(g, -2, -1 + ry, 8, 1, '#c98e54');
      px(g, 0, 2 + ry, 3, 2, PAL.gold2);
      px(g, 6, -6 + ry, 4, 12, PAL.ink);
      px(g, 7, -5 + ry, 2, 10, PAL.gold);
      px(g, 5, -6 + ry, 2, 2, PAL.gold2);
      px(g, 5, 4 + ry, 2, 2, PAL.gold2);
      px(g, 10, -1 + ry, 3, 3, PAL.stone3); /* 前端踏环 */
      seg(g, 6, -5 + ry, 2, ry, 1, 'rgba(244,236,220,0.65)');
      seg(g, 6, 5 + ry, 2, ry, 1, 'rgba(244,236,220,0.65)');
      px(g, 0, -1 + ry, 2, 2, PAL.red);     /* 红羽箭尾 */
      px(g, 2, -1 + ry, 9, 2, PAL.cyan);
      px(g, 10, -1 + ry, 4, 2, PAL.hi);
    } else if (rangedKey === 'orb') {
      const fy = Math.round(Math.sin(S.t * 5.5) * 1.8), fx = 8;
      g.fillStyle = 'rgba(176,124,240,0.26)';
      g.fillRect(fx - 5, -4 + fy, 10, 10);
      /* 多切面奥术棱晶球 + 双轨环绕星尘 */
      px(g, fx - 2, -4 + fy, 4, 8, PAL.ink);
      px(g, fx - 4, -2 + fy, 8, 4, PAL.ink);
      px(g, fx - 3, -3 + fy, 6, 6, PAL.ink);
      px(g, fx - 2, -3 + fy, 4, 6, PAL.violet2);
      px(g, fx - 3, -2 + fy, 6, 4, PAL.violet);
      px(g, fx - 2, -2 + fy, 3, 3, PAL.cyan);
      px(g, fx - 1, -2 + fy, 2, 2, PAL.hi);
      const ox1 = Math.round(Math.cos(S.t * 7) * 5), oy1 = Math.round(Math.sin(S.t * 7) * 4);
      px(g, fx + ox1, fy + oy1, 2, 1, PAL.cyan);
      px(g, fx - ox1, fy - oy1, 1, 2, PAL.gold);
    }
  }
  if (drT > 0.04) {
    px(g, -1, -1, 9, 1, PAL.hi);
    px(g, 3, -5, 1, 9, PAL.gold);
  }
  g.restore();
}
function drawRunHybrid(g, X, Y, anim, face) {
  const st = anim.st, f = anim.f || 0;
  const dir = face > 0 ? 1 : -1;
  const sx0 = P.sx || 1, sy0 = P.sy || 1;
  /* 攻击 / 下砸：烬铁巨剑专属双手三段狂暴挥砍动画，其余武器走通用序列 */
  if (st === 'attack' && anim.atkW === 'ember') {
    if (drawHeroEmberAttack(g, X, Y, anim, face, dir, sx0, sy0)) {
      S.lastDraw = 'hero-atk-ember';
      return;
    }
  }
  /* 攻击 / 下砸：整帧新素材（含腿）一次画完，加入爆发突进/后坐位移与三段式下砸过渡 */
  if (st === 'attack') {
    const set = ATK_IMGS[anim.atkW] || ATK_IMGS.knife;
    const fi = Math.min(f, set.length - 1);
    const isMelee = anim.atkW === 'knife' || anim.atkW === 'long' || anim.atkW === 'hammer';
    const atkOx = isMelee ? dir * (fi === 0 ? -2 : fi === 1 ? 3 : fi === 2 ? 2 : 1) : dir * (fi === 1 ? -2 : 0);
    const asx = sx0 * (isMelee && fi === 1 ? 1.05 : 1);
    const asy = sy0 * (isMelee && fi === 1 ? 0.96 : 1);
    if (ATK_READY[anim.atkW] >= set.length && drawHeroAI(g, X, Y, fi, face, 0, set, ATK_META[anim.atkW], atkOx, asx, asy)) {
      S.lastDraw = 'ai-atk-' + anim.atkW; return;
    }
  } else if (st === 'slam' && ATK_READY.hammer >= 4) {
    /* 下砸空中阶段：起手 0.065s 高举巨锤蓄势（帧 0），随后俯冲挥劈（帧 1）+ 纵向速度拉伸 */
    const sIdx = (P.slamT || 0) < 0.065 ? 0 : 1;
    const sBob = sIdx === 0 ? -2 : 0;
    const ssx = sIdx === 0 ? 0.94 : 0.88, ssy = sIdx === 0 ? 1.06 : 1.14;
    if (drawHeroAI(g, X, Y, sIdx, face, sBob, ATK_IMGS.hammer, null, 0, ssx, ssy)) {
      S.lastDraw = 'ai-slam'; return;
    }
  } else if ((P.slamLandT || 0) > 0 && P.onGround && Math.abs(P.vx) < 40 && ATK_READY.hammer >= 4) {
    /* 下砸触地阶段：前段砸地碎石（帧 2），后段收锤起身（帧 3）；移动或起跳可立即取消后摇 */
    const lIdx = P.slamLandT > 0.07 ? 2 : 3;
    if (drawHeroAI(g, X, Y, lIdx, face, 0, ATK_IMGS.hammer, null, 0, sx0, sy0)) {
      S.lastDraw = 'ai-slam'; return;
    }
  }
  const feetY = Math.round(Y) + Math.round(P.h / 2);
  let arr = LEG_RUN, idx = f % 8, bob = 0, need = 8, key = 'run';
  if (st === 'walk') { arr = LEG_WALK; idx = f % 8; bob = [0,0,-1,0,0,0,-1,0][idx]; key = 'walk'; }
  else if (st === 'idle') { arr = LEG_IDLE; idx = f % 2; bob = f ? 0 : -1; key = 'idle'; need = 2; }
  else if (st === 'jump') { arr = LEG_JUMP; idx = f % 2; bob = Math.abs(P.vy) < 85 ? -1 : 0; key = 'jump'; need = 2; }
  else if (st === 'fall') { arr = LEG_FALL; idx = f % 2; key = 'fall'; need = 2; }
  else if (st === 'climb') { arr = LEG_CLIMB; idx = f % 4; key = 'climb'; need = 4; }
  else if (st === 'wallslide') { arr = LEG_CLIMB; idx = f % 2; key = 'climb'; need = 4; }
  else if (st === 'dodge') { arr = LEG_DASH; idx = Math.max(0, Math.min(3, Math.floor((1 - P.dodgeT / CFG.dodge.dur) * 4))); key = 'dash'; need = 4; }
  else if (st === 'hurt') { arr = LEG_FALL; idx = 1; bob = 1; key = 'fall'; need = 2; }
  else { bob = [0,-1,0,1,0,-1,0,1][idx]; }
  if ((P.skidT || 0) > 0 && P.onGround && st !== 'dodge') { arr = LEG_DASH; idx = 0; key = 'dash'; need = 4; bob += 1; }
  if ((P.landT || 0) > 0 && P.onGround) { bob += Math.round((P.landT / 0.16) * 2.5); }
  S.lastDraw = 'hybrid-' + st;

  /* 脚底锚点弹性缩放（Squash & Stretch：起跳拉伸、下落流线、落地屈膝缓冲、闪避压低） */
  const fallStretch = (st === 'fall' && P.vy > 240) ? Math.min(0.08, (P.vy - 240) / 3600) : 0;
  const dodgeSx = st === 'dodge' ? 1.07 : 1, dodgeSy = st === 'dodge' ? 0.93 : 1;
  const fxScale = sx0 * (1 - fallStretch * 0.6) * dodgeSx;
  const fyScale = sy0 * (1 + fallStretch) * dodgeSy;
  const useTransform = Math.abs(fxScale - 1) > 0.01 || Math.abs(fyScale - 1) > 0.01;
  const cx0 = Math.round(X);
  if (useTransform) {
    g.save();
    g.translate(cx0, feetY);
    g.scale(fxScale, fyScale);
    g.translate(-cx0, -feetY);
  }

  const idle = st === 'idle';
  const idleOx = idle ? Math.round(Math.sin(S.idleT * 1.7) * 1.6) : 0;
  const idleOy = idle ? Math.round(Math.sin(S.idleT * 1.15) * 0.6) : 0;
  const bodyOx = st === 'hurt' ? -3 : ((P.skidT || 0) > 0 ? -2 : idleOx);
  const leanShift = S.lean * 3.2;
  const putUpper = (im, sw, dw, lp, tp, ox) => {
    const lx = cx0 - lp + (face > 0 ? ox : -ox);
    const sprite = heroImage(im, sw / 2, 34);
    if (face < 0) {
      g.save(); g.translate(cx0 * 2, 0); g.scale(-1, 1);
      g.drawImage(sprite, lx, tp, dw, 34);
      g.restore();
    } else g.drawImage(sprite, lx, tp, dw, 34);
  };

  /* 1. 全状态动态披风 + 像素飘带尾梢细节 */
  if (CAPE_READY >= 1 && UPPER_READY >= 1) {
    let capeOx = bodyOx, capeOy = 0, capeDw = 80, capeLp = 40;
    if (idle && S.lean <= 0.25) {
      const capeLag = Math.sin(S.idleT * 1.7 + 0.9) * 2.2 * Math.min(1, S.idleT / 0.8);
      capeOx = idleOx + Math.round(capeLag);
    } else {
      const spdRatio = Math.min(1.4, Math.abs(P.vx) / CFG.runMax);
      const flutter = Math.sin(S.t * (10 + spdRatio * 8)) * (0.8 + spdRatio * 1.1);
      const stretch = Math.round(spdRatio * 5 + (st === 'dodge' ? 5 : 0) + (st === 'fall' ? 2 : 0));
      capeDw = 80 + stretch;
      capeLp = 40 + stretch; /* 向角色身后拉长展开 */
      capeOx = bodyOx + Math.round(leanShift * 0.7 - spdRatio * 1.8 + flutter);
      if (st === 'jump') capeOy = 2;
      else if (st === 'fall') capeOy = -Math.round(Math.min(4, Math.max(1, P.vy / 115)));
      else if (st === 'dodge') capeOy = -1;
      else if ((P.landT || 0) > 0) capeOy = 2;
    }
    putUpper(UPPER_CAPE, 160, capeDw, capeLp, feetY - 50 + bob + idleOy + capeOy, capeOx);
    /* 高速移动/跳跃时的像素颈巾流苏尾梢 */
    if (!idle && (Math.abs(P.vx) > 65 || !P.onGround)) {
      const sx1 = cx0 - dir * (6 - Math.round(leanShift * 0.4)), sy1 = feetY - 36 + bob;
      const wave = Math.round(Math.sin(S.t * 18) * 2);
      const sx2 = sx1 - dir * (7 + (st === 'dodge' ? 4 : 0)), sy2 = sy1 + wave - (st === 'fall' ? 3 : 0);
      seg(g, sx1, sy1, sx2, sy2, 3, PAL.ink);
      seg(g, sx1, sy1, sx2, sy2, 1, PAL.red);
      px(g, sx2, sy2, 2, 1, PAL.gold);
    }
  }

  /* 2. 背负武器层（长刀背鞘/刀柄、后肩铁锤、后腰短刀鞘与副武器） */
  const top = feetY - 50 + bob + idleOy;
  if (UPPER_READY >= 1) {
    drawBackWeapon(g, cx0, top, dir, leanShift + bodyOx, st);
  }

  /* 3. 腿部层 */
  const img = arr[idx];
  if (READY_LEG[key] >= need && img && img.complete && img.naturalWidth) {
    const lx = cx0 - 40, ly = feetY - 22;
    const sprite = heroImage(img, 80, 22);
    if (face < 0) {
      g.save(); g.translate(cx0 * 2, 0); g.scale(-1, 1);
      g.drawImage(sprite, lx, ly, 80, 22);
      g.restore();
    } else g.drawImage(sprite, lx, ly, 80, 22);
  } else {
    drawCrossLegs(g, X + dir * 2, feetY, dir, (f % 8) / 8, st === 'run' ? 13 : 7, st === 'run' ? 64 : 30);
  }

  /* 4. 全状态远景后手（两段式关节：肩甲→护腕肘→皮手套指节，跑/走摆臂，跳/落/闪/爬协同） */
  if (st !== 'idle') {
    const sx = cx0 + dir * Math.round(leanShift * 0.6 + bodyOx), sy = feetY - 33 + bob;
    let ex = sx, ey = sy + 4, hx = sx, hy = sy + 7;
    if (st === 'run' || st === 'walk') {
      const ph = (f % 8) / 8 * Math.PI * 2;
      const a = Math.sin(ph);
      const amp = st === 'run' ? 10 : 6.5;
      ex = sx + dir * Math.round(a * amp * 0.45 + 1.5);
      ey = sy + 4 + Math.round(Math.abs(a) * 1.2);
      hx = sx + dir * Math.round(a * amp + 1);
      hy = sy + 7 + Math.round(Math.abs(a) * 2 - (a > 0 ? 2 : 0));
    } else if (st === 'jump') {
      ex = sx + dir * 4; ey = sy + 1; hx = sx + dir * 8; hy = sy - 3;
    } else if (st === 'fall') {
      ex = sx - dir * 4; ey = sy + 1; hx = sx - dir * 8; hy = sy - 2;
    } else if (st === 'dodge') {
      ex = sx - dir * 5; ey = sy + 2; hx = sx - dir * 11; hy = sy + 4;
    } else if (st === 'climb' || st === 'wallslide') {
      const cyOff = st === 'climb' ? [ -3, 0, 3, 0 ][f % 4] : -2;
      ex = sx + dir * 4; ey = sy + 2 + cyOff; hx = sx + dir * 8; hy = sy - 2 + cyOff;
    } else if (st === 'hurt') {
      ex = sx - dir * 4; ey = sy + 2; hx = sx - dir * 8; hy = sy + 1;
    }
    seg(g, sx, sy, ex, ey, 5, PAL.ink);
    seg(g, ex, ey, hx, hy, 5, PAL.ink);
    seg(g, sx, sy, ex, ey, 3, PAL.violet3);
    seg(g, ex, ey, hx, hy, 3, PAL.stone2);
    /* 肩甲亮边 + 小臂金护腕箍 + 手套指节高光 */
    px(g, sx - 1, sy - 1, 3, 1, PAL.violet);
    px(g, Math.round((ex + hx) * 0.5) - 1, Math.round((ey + hy) * 0.5) - 1, 2, 2, PAL.gold2);
    px(g, hx - 2, hy - 2, 5, 4, PAL.ink);
    px(g, hx - 1, hy - 1, 3, 2, '#d69a6a');
    px(g, hx + (dir > 0 ? 1 : -1), hy - 1, 1, 1, '#f2c49b');
  }

  /* 5. 五档平滑前倾上半身（0° / 6° / 10° / 12° / 18°） */
  if (UPPER_READY < 1) { if (useTransform) g.restore(); return; }
  let img2 = UPPER_IMG, iw = 80, sw = 160, leftPad = 40;
  const useNoHand = S.lean <= 0.18 && NOHAND_READY >= 1 && HAND_READY >= 1;
  if (useNoHand) img2 = UPPER_NOHAND;
  if (S.lean > 0.82 && LEAN18_READY >= 1) { img2 = UPPER_LEAN18; iw = 95; sw = 190; leftPad = 42; }
  else if (S.lean > 0.62 && LEAN12_READY >= 1) { img2 = UPPER_LEAN12; iw = 92; sw = 184; leftPad = 42; }
  else if (S.lean > 0.40 && LEAN10_READY >= 1) { img2 = UPPER_LEAN10; iw = 90; sw = 180; leftPad = 42; }
  else if (S.lean > 0.18 && LEAN6_READY >= 1) { img2 = UPPER_LEAN6; iw = 88; sw = 176; leftPad = 41; }
  putUpper(img2, sw, iw, leftPad, top, bodyOx);

  /* 6. 近景前手协同 + 随身手持武器与拔刀/收刀衔接 */
  let handDx = 0, handDy = 0;
  if (idle) {
    handDy = Math.round(Math.sin(S.idleT * 2.15) * 1.2);
    handDx = Math.round(Math.sin(S.idleT * 2.15) * 0.7);
  } else if (st === 'run' || st === 'walk') {
    const ph = (f % 8) / 8 * Math.PI * 2;
    /* 前手与后手反相前后摆动 */
    handDx = Math.round(-Math.sin(ph) * (st === 'run' ? 2.5 : 1.5));
    handDy = Math.round(Math.cos(ph * 2) * 1.0);
  } else if (st === 'jump') {
    handDx = 1; handDy = -2;
  } else if (st === 'fall') {
    handDx = -1; handDy = -1;
  } else if (st === 'climb' || st === 'wallslide') {
    handDx = 1; handDy = st === 'climb' ? [ 2, 0, -2, 0 ][f % 4] : -1;
  } else if (st === 'dodge') {
    handDx = 2; handDy = 1;
  } else if (st === 'hurt') {
    handDx = -2; handDy = -1;
  }
  if (useNoHand) {
    putUpper(HAND_IMG, 160, 80, 40, top + handDy, bodyOx + handDx);
  }
  const frontHandX = cx0 + dir * (15 + Math.round(leanShift * 0.85) + bodyOx + handDx);
  const frontHandY = top + 26 + handDy;
  drawFrontWeapon(g, frontHandX, frontHandY, dir, st);

  if (useTransform) g.restore();
}
function drawWisp(g, x, y, flash, t, m) {
  const wind = m && m.state === 'windup', chg = m && m.state === 'charge';
  x = Math.round(x);
  y = Math.round(y) + (chg ? 0 : Math.round(Math.sin(t * 3.2) * 2));
  const f = flash > 0 || (wind && Math.floor(t * 24) % 2 === 0);
  if (wind || chg) {
    const ang = (m && m.aimAng !== undefined) ? m.aimAng : 0;
    if (wind) seg(g, x, y, x + Math.cos(ang) * 28, y + Math.sin(ang) * 28, 1.4, 'rgba(224,60,49,0.75)');
    else seg(g, x - Math.cos(ang) * 18, y - Math.sin(ang) * 18, x, y, 2, PAL.red2);
  }
  /* 幽魂三缕灵焰尾须 + 头顶鬼火苗 + 环绕微尘 */
  const tw = Math.round(Math.sin(t * 6) * 2);
  px(g, x - 7 + tw, y + 7, 4, 7, PAL.ink);
  px(g, x - 6 + tw, y + 7, 2, 6, f ? PAL.hi : PAL.stone2);
  px(g, x - 1, y + 8, 4, 8, PAL.ink);
  px(g, x, y + 8, 2, 7, f ? PAL.hi : '#6a619c');
  px(g, x + 4 - tw, y + 6, 4, 6, PAL.ink);
  px(g, x + 5 - tw, y + 6, 2, 5, f ? PAL.hi : '#524b78');
  /* 倒角圆润魂壳与受光眉骨 */
  px(g, x - 11, y - 7, 22, 14, PAL.ink);
  px(g, x - 9, y - 10, 18, 19, PAL.ink);
  px(g, x - 6, y - 12, 12, 22, PAL.ink);
  px(g, x - 2 - Math.round(tw * 0.5), y - 15, 4, 4, PAL.ink);
  px(g, x - 1 - Math.round(tw * 0.5), y - 14, 2, 3, f ? PAL.hi : (chg ? PAL.red : PAL.cyan));
  /* 大块魂壳暗腹/正面/左上眉骨，与主角紫布共用三档，不靠外框提亮。 */
  px(g, x - 10, y - 6, 20, 12, f ? UNIT_HI : UNIT_TONE.violet[0]);
  px(g, x - 8, y - 9, 16, 17, f ? UNIT_HI : UNIT_TONE.violet[0]);
  px(g, x - 8, y - 8, 12, 12, f ? UNIT_HI : UNIT_TONE.violet[1]);
  px(g, x - 5, y - 11, 10, 3, f ? UNIT_HI : UNIT_TONE.violet[2]);
  px(g, x - 8, y - 8, 3, 4, f ? UNIT_HI : UNIT_TONE.violet[2]);
  /* 飘浮魂火微粒 */
  const mx1 = Math.round(Math.cos(t * 4.2) * 12), my1 = Math.round(Math.sin(t * 4.2) * 8);
  px(g, x + mx1, y + my1, 2, 2, 'rgba(72,201,176,0.65)');
  /* 视线实时追踪玩家的立体金瞳 */
  const dx = m ? P.x - m.x : 0, dy = m ? P.y - m.y : 0, dn = Math.hypot(dx, dy) || 1;
  const ex = Math.round(dx / dn * 2), ey = Math.round(dy / dn * 2);
  px(g, x - 6, y - 5, 12, 10, PAL.ink);
  px(g, x - 5, y - 6, 10, 12, PAL.ink);
  px(g, x - 5, y - 4, 10, 8, chg ? PAL.red2 : PAL.gold2);
  px(g, x - 4, y - 5, 8, 10, chg ? PAL.red : PAL.gold);
  px(g, x - 1 + ex, y - 3 + ey, 3, 6, PAL.ink);
  px(g, x + ex, y - 2 + ey, 1, 4, chg ? PAL.hi : PAL.red);
  px(g, x - 3, y - 4, 2, 2, PAL.hi);
}
function drawCrawler(g, x, y, flash, dir, t, m) {
  const wind = m && m.state === 'windup', lunge = m && m.state === 'lunge';
  x = Math.round(x); y = Math.round(y);
  const f = flash > 0 || (wind && Math.floor(t * 24) % 2 === 0), d = dir || 1;
  if (wind || lunge) {
    seg(g, x + d * 12, y, x + d * (wind ? 30 : 20), y, 1.5, lunge ? PAL.gold : 'rgba(224,60,49,0.80)');
  }
  /* 三节叠甲虫壳 + 甲缝暗槽 + 背脊骨刺 */
  px(g, x - 15, y - 7, 30, 14, PAL.ink);
  px(g, x - 13, y - 10, 26, 17, PAL.ink);
  px(g, x - 14, y - 6, 28, 12, f ? UNIT_HI : UNIT_TONE.violet[0]);
  px(g, x - 12, y - 9, 24, 12, f ? UNIT_HI : UNIT_TONE.violet[1]);
  px(g, x + 8, y - 6, 4, 9, f ? UNIT_HI : UNIT_TONE.violet[0]);
  px(g, x - 12, y - 9, 20, 2, f ? UNIT_HI : UNIT_TONE.violet[2]);
  px(g, x - 12, y - 7, 3, 5, f ? UNIT_HI : UNIT_TONE.violet[2]);
  /* 叠甲节缝 */
  px(g, x - 5, y - 7, 1, 11, PAL.ink3);
  px(g, x + 3, y - 7, 1, 11, PAL.ink3);
  for (let i = -2; i <= 2; i++) {
    const sx = x + i * 5;
    px(g, sx - 2, y - 14 + Math.abs(i), 4, 5, PAL.ink);
    px(g, sx - 1, y - 13 + Math.abs(i), 2, 4, f ? PAL.hi : PAL.violet);
    px(g, sx - 1, y - 13 + Math.abs(i), 1, 2, PAL.gold);
  }
  /* 开合弯钩毒颚与双复眼（蓄力猛扑时毒颚大幅张开闪红白寒芒） */
  const jaw = (wind || lunge) ? 2 : (Math.round(Math.sin(t * 12)) > 0 ? 1 : 0);
  px(g, x + d * 13 - 2, y - 3 - jaw, 5, 4, PAL.ink);
  px(g, x + d * 13 - 1, y - 2 - jaw, 3, 2, lunge ? PAL.red : PAL.hi);
  px(g, x + d * 13 - 2, y + 1 + jaw, 5, 4, PAL.ink);
  px(g, x + d * 13 - 1, y + 2 + jaw, 3, 2, lunge ? PAL.hi : PAL.gold);
  px(g, x + d * 8 - 2, y - 5, 5, 5, PAL.ink);
  px(g, x + d * 8 - 1, y - 4, 3, 3, PAL.red);
  px(g, x + d * 8, y - 4, 1, 1, PAL.hi);
  /* 四对带折角关节与利爪的步足 */
  const lg = Math.round(t * 11) % 2;
  for (let i = 0; i < 4; i++) {
    const ly = ((i + lg) % 2) * 2;
    const lx = x - 11 + i * 7;
    px(g, lx - 1, y + 5, 4, 4 + ly, PAL.ink);
    px(g, lx, y + 5, 2, 3 + ly, PAL.violet2);
    px(g, lx + (i < 2 ? -1 : 1), y + 8 + ly, 2, 2, PAL.gold2);
  }
}
/* 符蛾（扇形弹幕怪）：雕花燕尾双层磷翅 + 发光眼斑 + 羽状触角 + 聚能符印 */
function drawMoth(g, x, y, m) {
  x = Math.round(x); y = Math.round(y);
  const f = m.flash > 0, chg = m.charge || 0;
  const flap = Math.sin(m.t * (chg > 0 ? 34 : 13));
  const ws = Math.max(4, Math.round(12 + flap * 5));
  const wy = Math.round(-flap * 3);
  /* 左右上下四片燕尾磷翅 */
  for (const s of [-1, 1]) {
    const wx = s < 0 ? x - 4 - ws : x + 4;
    px(g, wx - 1, y - 10 + wy, ws + 2, 13, PAL.ink);
    px(g, wx, y - 11 + wy, Math.max(2, ws - 2), 14, PAL.ink);
    px(g, wx, y - 9 + wy, ws, 11, f ? UNIT_HI : UNIT_TONE.violet[0]);
    px(g, wx + 1, y - 9 + wy, Math.max(2, ws - 3), 7, f ? UNIT_HI : UNIT_TONE.violet[1]);
    px(g, wx + 1, y - 10 + wy, Math.max(2, ws - 2), 2, f ? UNIT_HI : UNIT_TONE.violet[2]);
    if (ws >= 7) {
      const ex0 = s < 0 ? wx + 2 : wx + ws - 7;
      px(g, ex0, y - 7 + wy, 5, 6, f ? PAL.hi : PAL.cyan2);
      px(g, ex0 + 1, y - 6 + wy, 3, 4, PAL.cyan);
      px(g, ex0 + 2, y - 5 + wy, 2, 2, PAL.hi);
      px(g, s < 0 ? wx + ws - 3 : wx + 1, y - 3 + wy, 2, 3, PAL.gold);
    }
    /* 下燕尾翅与飘带尖 */
    const sw = Math.max(3, Math.round(ws * 0.68));
    const sx0 = s < 0 ? x - 3 - sw : x + 3;
    px(g, sx0 - (s < 0 ? 1 : 0), y + 2 - wy, sw + 1, 7, PAL.ink);
    px(g, sx0, y + 3 - wy, sw, 5, f ? PAL.hi : PAL.violet2);
    px(g, s < 0 ? sx0 + 1 : sx0 + sw - 3, y + 8 - wy, 3, 4, PAL.ink);
    px(g, s < 0 ? sx0 + 2 : sx0 + sw - 2, y + 8 - wy, 1, 3, PAL.cyan);
  }
  /* 羽状分叉触角 + 绒毛胸甲 + 环纹虫腹 */
  px(g, x - 5, y - 14, 3, 2, PAL.cyan); px(g, x - 3, y - 12, 2, 3, PAL.gold);
  px(g, x + 2, y - 14, 3, 2, PAL.cyan); px(g, x + 1, y - 12, 2, 3, PAL.gold);
  px(g, x - 5, y - 9, 10, 19, PAL.ink);
  px(g, x - 4, y - 8, 8, 6, f ? PAL.hi : '#d9d2f2'); /* 银白绒毛领 */
  px(g, x - 4, y - 2, 8, 10, f ? PAL.hi : PAL.ink3);
  for (let r = 0; r < 3; r++) px(g, x - 3, y + 1 + r * 3, 6, 1, PAL.violet2);
  px(g, x - 3, y - 7, 2, 3, PAL.cyan); px(g, x + 1, y - 7, 2, 3, PAL.cyan);
  px(g, x - 2, y - 2, 4, 5, chg > 0 ? PAL.hi : PAL.violet);
  if (chg > 0) {
    const u = Math.min(1, chg / 0.50);
    g.strokeStyle = chg < 0.16 ? PAL.hi : PAL.cyan;
    g.lineWidth = 1.6;
    g.beginPath(); g.arc(x, y + 1, 4 + u * 11, 0, Math.PI * 2); g.stroke();
  }
}
/* 爆炎蝠（锁定飞扑自爆怪）：翼骨扇贝蝠翼 + 毒牙尖耳 + 脉动裂纹熔岩腹囊 */
function drawBomber(g, x, y, m) {
  x = Math.round(x); y = Math.round(y);
  const locking = m.state === 'lock', diving = m.state === 'dive';
  const blink = (locking && Math.floor(m.t * 24) % 2 === 0) || m.flash > 0;
  const flap = Math.round(Math.sin(m.t * (locking || diving ? 32 : 15)) * 4);
  if (locking || diving) {
    const ang = m.aimAng || 0;
    const len = locking ? 34 : 18;
    g.save();
    g.strokeStyle = locking ? 'rgba(224,60,49,0.78)' : 'rgba(235,179,75,0.55)';
    g.lineWidth = locking ? 1.5 : 2;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len); g.stroke();
    g.restore();
  }
  /* 带翼骨与扇贝齿边的双翼 */
  for (const s of [-1, 1]) {
    const wx = s < 0 ? x - 17 : x + 5;
    px(g, wx, y - 7 + flap, 12, 8, PAL.ink);
    px(g, wx + 1, y - 6 + flap, 10, 6, blink ? UNIT_HI : UNIT_TONE.red[0]);
    px(g, wx + 1, y - 6 + flap, 8, 4, blink ? UNIT_HI : UNIT_TONE.red[1]);
    px(g, wx + 1, y - 6 + flap, 10, 1, blink ? UNIT_HI : UNIT_TONE.red[2]);
    /* 翼骨把亮上缘与暗扇贝膜连成结构，不增加装饰框。 */
    px(g, wx + 4, y - 5 + flap, 1, 3, blink ? UNIT_HI : UNIT_TONE.red[2]);
    px(g, s < 0 ? wx + 1 : wx + 9, y - 8 + flap, 2, 2, PAL.gold2); /* 翼爪 */
    px(g, wx + 3, y - 1 + flap, 2, 2, PAL.ink);
    px(g, wx + 7, y - 1 + flap, 2, 2, PAL.ink);
  }
  /* 尖耳 + 导火冠 + 蝠首毒牙 + 鼓胀熔岩裂纹火囊 */
  px(g, x - 6, y - 13, 4, 5, PAL.ink); px(g, x + 2, y - 13, 4, 5, PAL.ink);
  px(g, x - 5, y - 12, 2, 3, '#6b2536'); px(g, x + 3, y - 12, 2, 3, '#6b2536');
  px(g, x - 1, y - 14, 2, 4, PAL.gold); px(g, x - 1, y - 15, 2, 2, PAL.hi);
  px(g, x - 7, y - 9, 14, 19, PAL.ink);
  px(g, x - 6, y - 8, 12, 8, blink ? UNIT_HI : UNIT_TONE.red[0]);
  px(g, x - 6, y - 8, 8, 5, blink ? UNIT_HI : UNIT_TONE.red[1]);
  px(g, x - 6, y - 8, 9, 1, blink ? UNIT_HI : UNIT_TONE.red[2]);
  const pulse = Math.round(Math.sin(m.t * (locking ? 28 : 8)) * 1);
  px(g, x - 7 - pulse, y - 1, 14 + pulse * 2, 10 + pulse, PAL.ink);
  px(g, x - 6 - pulse, y, 12 + pulse * 2, 8 + pulse, blink ? PAL.hi : PAL.red2);
  px(g, x - 4 - pulse, y + 1, 8 + pulse * 2, 6 + pulse, blink ? PAL.hi : PAL.red);
  px(g, x - 3, y + 2, 6, 4, PAL.gold);
  px(g, x - 1, y + 3, 2, 2, UNIT_HI);
  /* 怒目与白森森尖牙 */
  px(g, x - 4, y - 6, 3, 2, PAL.gold); px(g, x + 1, y - 6, 3, 2, PAL.gold);
  px(g, x - 3, y - 3, 1, 2, PAL.hi); px(g, x + 2, y - 3, 1, 2, PAL.hi);
  /* 锁定头顶感叹号预警 */
  if (locking) {
    px(g, x - 2, y - 25, 4, 10, PAL.ink);
    px(g, x - 1, y - 24, 2, 5, PAL.red);
    px(g, x - 1, y - 18, 2, 2, PAL.gold);
  }
}
/* 影刃鬼侍（锁定横冲突刺怪）：弦月兜盔 + 狰狞鬼面 + 大袖重甲 + 血纹妖刀 */
function drawRaider(g, x, y, m) {
  x = Math.round(x); y = Math.round(y);
  const f = m.flash > 0, d = m.dir || 1;
  const aiming = m.state === 'aim', dashing = m.state === 'dash';
  if (aiming) {
    /* 居合锁定：沿平台方向画出猩红斩击预警线 */
    const endX = d > 0 ? Math.min(m.x1, m.x + 115) : Math.max(m.x0, m.x - 115);
    const blink = Math.floor(m.t * 24) % 2 === 0;
    g.save();
    g.strokeStyle = blink ? PAL.hi : PAL.red;
    g.lineWidth = blink ? 2 : 1.5;
    g.beginPath(); g.moveTo(x, y + 2); g.lineTo(Math.round(endX), y + 2); g.stroke();
    g.restore();
  }
  const crouch = aiming ? 3 : (dashing ? 2 : 0);
  const lean = dashing ? d * 4 : (aiming ? -d * 2 : 0);
  const bx = x + lean, by = y + crouch;
  /* 黄金弦月前立兜盔 + 鸐尾吹返护颈 */
  px(g, bx - 7, by - 20, 3, 5, PAL.ink); px(g, bx + 4, by - 20, 3, 5, PAL.ink);
  px(g, bx - 6, by - 19, 2, 4, PAL.gold); px(g, bx + 4, by - 19, 2, 4, PAL.gold);
  px(g, bx - 3, by - 17, 6, 2, PAL.gold2);
  px(g, bx - 9, by - 15, 18, 12, PAL.ink);
  px(g, bx - 8, by - 14, 16, 10, f ? UNIT_HI : UNIT_TONE.stone[0]);
  px(g, bx - 8, by - 14, 11, 4, f ? UNIT_HI : UNIT_TONE.stone[1]);
  px(g, bx - 8, by - 14, 13, 1, f ? UNIT_HI : UNIT_TONE.stone[2]);
  px(g, bx - 7, by - 10, 14, 6, f ? UNIT_HI : PAL.ink3);
  /* 鬼面赤瞳与獠牙面具 */
  px(g, bx + d * 2 - 3, by - 10, 3, 2, PAL.red); px(g, bx + d * 6 - 3, by - 10, 3, 2, PAL.red);
  px(g, bx + d * 2 - 2, by - 10, 1, 1, PAL.hi);
  px(g, bx + d * 3 - 2, by - 7, 4, 2, PAL.red2);
  px(g, bx + d * 4 - 1, by - 7, 1, 1, PAL.hi);
  /* 胴丸胸甲 + 双肩大袖（Sode） + 草摺甲裙 */
  px(g, bx - 10, by - 3, 20, 13 - crouch, PAL.ink);
  px(g, bx - 9, by - 2, 18, 11 - crouch, f ? UNIT_HI : UNIT_TONE.stone[0]);
  px(g, bx - 8, by - 2, 11, 7, f ? UNIT_HI : UNIT_TONE.stone[1]);
  px(g, bx - 9, by - 3, 5, 6, f ? UNIT_HI : UNIT_TONE.red[1]);
  px(g, bx + 4, by - 3, 5, 6, f ? UNIT_HI : UNIT_TONE.red[0]);
  px(g, bx - 9, by - 3, 5, 1, f ? UNIT_HI : UNIT_TONE.red[2]);
  px(g, bx + 4, by - 3, 5, 1, f ? UNIT_HI : UNIT_TONE.red[2]);
  px(g, bx - 6, by + 2, 12, 2, PAL.gold2);
  px(g, bx - 7, by + 5, 5, 4 - Math.min(2, crouch), PAL.ink3);
  px(g, bx + 2, by + 5, 5, 4 - Math.min(2, crouch), PAL.ink3);
  /* 胫当战靴 */
  const step = (m.state === 'patrol') ? Math.round(Math.sin(m.t * 10) * 2) : 0;
  px(g, bx - 6 + step, y + 10, 5, 5, PAL.ink);
  px(g, bx - 5 + step, y + 11, 3, 3, PAL.stone2);
  px(g, bx + 1 - step, y + 10, 5, 5, PAL.ink);
  px(g, bx + 2 - step, y + 11, 3, 3, PAL.stone2);
  /* 赤刃妖刀：金刀镡 + 沸腾刃纹 */
  if (dashing) {
    seg(g, bx - d * 4, by + 2, bx + d * 22, by + 1, 4, PAL.ink);
    seg(g, bx - d * 2, by + 2, bx + d * 21, by + 1, 2, PAL.red);
    seg(g, bx + d * 3, by + 1, bx + d * 22, by + 1, 1, PAL.hi);
    px(g, bx + d * 2 - 1, by, 3, 5, PAL.gold);
  } else if (aiming) {
    seg(g, bx - d * 2, by + 3, bx - d * 15, by + 6, 3, PAL.ink);
    seg(g, bx - d * 2, by + 3, bx - d * 14, by + 6, 1, PAL.red);
    const gx = bx + d * 4, gy = by + 2;
    px(g, gx - 6, gy, 13, 1, PAL.hi); px(g, gx, gy - 6, 1, 13, PAL.red);
    px(g, gx - 1, gy - 1, 3, 3, PAL.gold);
  } else {
    seg(g, bx + d * 3, by + 3, bx + d * 15, by - 5, 3, PAL.ink);
    seg(g, bx + d * 4, by + 3, bx + d * 14, by - 5, 1, PAL.red);
    seg(g, bx + d * 6, by + 1, bx + d * 14, by - 5, 1, PAL.hi);
    px(g, bx + d * 3 - 1, by + 1, 3, 3, PAL.gold);
  }
}
/* 掷火壶灵（抛物线爆弹怪）：双角炉岩小鬼 + 铸铁炉栅肚膛 + 麻绳封口火油陶壶 */
function drawGrenadier(g, x, y, m) {
  x = Math.round(x); y = Math.round(y);
  const f = m.flash > 0, d = m.dir || -1, chg = m.charge || 0;
  const bob = chg > 0 ? 0 : Math.round(Math.sin(m.t * 6) * 1);
  /* 熔岩短角 + 护额铜箍 + 粗砺灰岩躯体 */
  px(g, x - 7, y - 14 + bob, 3, 4, PAL.ink); px(g, x + 4, y - 14 + bob, 3, 4, PAL.ink);
  px(g, x - 6, y - 13 + bob, 2, 3, PAL.gold2); px(g, x + 4, y - 13 + bob, 2, 3, PAL.gold2);
  px(g, x - 9, y - 11 + bob, 18, 21, PAL.ink);
  px(g, x - 8, y - 10 + bob, 16, 19, f ? UNIT_HI : UNIT_TONE.stone[0]);
  px(g, x - 8, y - 10 + bob, 11, 16, f ? UNIT_HI : UNIT_TONE.stone[1]);
  px(g, x - 8, y - 10 + bob, 3, 12, f ? UNIT_HI : UNIT_TONE.stone[2]);
  px(g, x - 7, y - 11 + bob, 14, 4, f ? UNIT_HI : UNIT_TONE.brass[1]);
  px(g, x - 7, y - 11 + bob, 14, 1, f ? UNIT_HI : UNIT_TONE.brass[2]);
  px(g, x - 7, y - 8 + bob, 14, 1, PAL.gold2);
  /* 灼热金瞳 + 肚膛铸铁炉栅与透火炭芯 */
  px(g, x + d * 3 - 3, y - 6 + bob, 3, 3, PAL.gold);
  px(g, x + d * 7 - 3, y - 6 + bob, 2, 3, PAL.gold);
  px(g, x + d * 3 - 2, y - 6 + bob, 1, 1, PAL.hi);
  px(g, x - 5, y + bob, 10, 7, PAL.ink);
  px(g, x - 4, y + 1 + bob, 8, 5, PAL.red2);
  px(g, x - 3, y + 2 + bob, 6, 3, PAL.gold);
  px(g, x - 2, y + 1 + bob, 1, 5, PAL.ink);
  px(g, x + 1, y + 1 + bob, 1, 5, PAL.ink);
  px(g, x - 7, y + 10, 5, 3, PAL.ink); px(g, x + 2, y + 10, 5, 3, PAL.ink);
  /* 圆腹火油陶壶（蓄力时双手高举过顶） */
  const jx = chg > 0 ? x + Math.round(Math.sin(m.t * 30) * 1) : x + d * 8;
  const jy = chg > 0 ? y - 20 : y - 2 + bob;
  if (chg > 0) {
    px(g, x - 7, y - 15, 3, 6, PAL.ink); px(g, x + 4, y - 15, 3, 6, PAL.ink);
  }
  px(g, jx - 5, jy - 4, 10, 9, PAL.ink);
  px(g, jx - 4, jy - 5, 8, 11, PAL.ink);
  px(g, jx - 4, jy - 3, 8, 7, '#994f28');
  px(g, jx - 3, jy - 4, 6, 9, '#b56335');
  px(g, jx - 3, jy - 6, 6, 2, '#d9b87a'); /* 麻绳封口 */
  px(g, jx - 4, jy - 1, 8, 2, PAL.gold2);
  px(g, jx - 2, jy - 3, 2, 2, PAL.hi);    /* 陶釉高光 */
  /* 滋滋跳跃的引信火苗 */
  const fl = Math.floor(m.t * 16) % 2;
  px(g, jx - 1, jy - 10 - fl, 4, 4, PAL.red);
  px(g, jx, jy - 9 - fl, 2, 3, PAL.gold);
  px(g, jx, jy - 8 - fl, 1, 1, PAL.hi);
}
/* 咒目魔瞳（红线锁定狙击怪）：金镶八角黑曜石魔匣 + 悬浮符文翼 + 血丝魔眼 */
function drawSniper(g, x, y, m) {
  x = Math.round(x); y = Math.round(y);
  const f = m.flash > 0;
  const tracking = m.state === 'track', locked = m.state === 'lock';
  if ((tracking || locked) && !m.dead) {
    const ang = m.aimAng || 0;
    const len = 290;
    const ex = x + Math.cos(ang) * len, ey = y + Math.sin(ang) * len;
    g.save();
    if (locked) {
      const blink = Math.floor(m.t * 36) % 2 === 0;
      g.strokeStyle = blink ? '#ffffff' : PAL.red;
      g.lineWidth = blink ? 2.2 : 1.5;
      g.beginPath(); g.moveTo(x, y); g.lineTo(ex, ey); g.stroke();
    } else {
      g.strokeStyle = 'rgba(224,60,49,0.48)';
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(x, y); g.lineTo(ex, ey); g.stroke();
      const dist = Math.min(len, Math.hypot(P.x - m.x, P.y - m.y));
      const tx = Math.round(x + Math.cos(ang) * dist), ty = Math.round(y + Math.sin(ang) * dist);
      px(g, tx - 3, ty - 3, 7, 7, 'rgba(224,60,49,0.55)');
      px(g, tx - 1, ty - 1, 3, 3, PAL.hi);
    }
    g.restore();
  }
  const open = (tracking || locked) ? 4 : Math.round(Math.sin(m.t * 3) * 1 + 1);
  /* 上下左右四枚镶金黑曜石符文棱翼 + 四角聚能珠 */
  px(g, x - 5, y - 14 - open, 10, 6, PAL.ink);
  px(g, x - 4, y - 13 - open, 8, 4, f ? PAL.hi : PAL.stone);
  px(g, x - 2, y - 12 - open, 4, 2, PAL.gold);
  px(g, x - 5, y + 8 + open, 10, 6, PAL.ink);
  px(g, x - 4, y + 9 + open, 8, 4, f ? PAL.hi : PAL.stone);
  px(g, x - 2, y + 10 + open, 4, 2, PAL.gold);
  px(g, x - 14 - open, y - 5, 6, 10, PAL.ink);
  px(g, x - 13 - open, y - 4, 4, 8, f ? PAL.hi : PAL.stone);
  px(g, x - 12 - open, y - 2, 2, 4, PAL.gold);
  px(g, x + 8 + open, y - 5, 6, 10, PAL.ink);
  px(g, x + 9 + open, y - 4, 4, 8, f ? PAL.hi : PAL.stone);
  px(g, x + 10 + open, y - 2, 2, 4, PAL.gold);
  if (tracking || locked) {
    for (const [cx1, cy1] of [[-9, -9], [7, -9], [-9, 7], [7, 7]]) px(g, x + cx1, y + cy1, 2, 2, locked ? PAL.hi : PAL.red);
  }
  /* 八角切面黑曜石核与深红竖瞳 */
  px(g, x - 8, y - 6, 16, 12, PAL.ink);
  px(g, x - 6, y - 8, 12, 16, PAL.ink);
  px(g, x - 7, y - 5, 14, 10, f ? UNIT_HI : UNIT_TONE.stone[0]);
  px(g, x - 5, y - 7, 10, 14, f ? UNIT_HI : UNIT_TONE.stone[1]);
  px(g, x - 5, y - 7, 10, 2, f ? UNIT_HI : UNIT_TONE.stone[2]);
  px(g, x - 7, y - 5, 2, 7, f ? UNIT_HI : UNIT_TONE.stone[2]);
  px(g, x - 5, y - 5, 10, 10, locked ? PAL.hi : PAL.red2);
  px(g, x - 4, y - 4, 8, 8, locked ? PAL.gold : PAL.red);
  const ang = m.aimAng !== undefined ? m.aimAng : Math.atan2(P.y - m.y, P.x - m.x);
  const pxOff = Math.round(Math.cos(ang) * 2), pyOff = Math.round(Math.sin(ang) * 2);
  px(g, x - 2 + pxOff, y - 3 + pyOff, 4, 6, PAL.gold);
  px(g, x - 1 + pxOff, y - 3 + pyOff, 2, 6, PAL.ink);
  px(g, x - 4, y - 4, 2, 2, PAL.hi);
}
/* 壁挂弩机（可破坏机关）：带三角肋板的铆接铸铁壁座 + 齿轮绞盘 + 复合铜弩臂 + 羽箭 */
function drawTurret(g, x, y, m) {
  x = Math.round(x); y = Math.round(y);
  const f = m.flash > 0, d = m.dir || 1, chg = (m.charge || 0) > 0;
  if (chg && !m.dead) {
    g.save();
    g.strokeStyle = Math.floor(m.t * 30) % 2 === 0 ? PAL.gold : PAL.red;
    g.lineWidth = 1.2;
    if (g.setLineDash) g.setLineDash([4, 4]);
    g.beginPath(); g.moveTo(x + d * 8, y); g.lineTo(x + d * 180, y); g.stroke();
    g.restore();
  }
  /* 铆接铸铁承重壁座 + 三角斜撑肋 */
  const bx = d > 0 ? x - 7 : x + 1;
  px(g, bx, y - 10, 6, 20, PAL.ink);
  px(g, bx + 1, y - 9, 4, 18, f ? PAL.hi : PAL.stone);
  px(g, bx + (d > 0 ? 4 : 1), y - 9, 1, 18, PAL.stone3);
  px(g, bx + 2, y - 7, 2, 2, PAL.gold);
  px(g, bx + 2, y + 5, 2, 2, PAL.gold);
  px(g, d > 0 ? bx + 5 : bx - 3, y + 2, 3, 5, PAL.ink);
  px(g, d > 0 ? bx + 5 : bx - 2, y + 3, 2, 3, PAL.stone2);
  /* 弧形复合铜弩臂与张紧弓弦 */
  const ax = x + d * 3;
  px(g, ax - 2, y - 11, 4, 22, PAL.ink);
  px(g, ax - 1, y - 10, 2, 20, f ? PAL.hi : PAL.gold2);
  px(g, ax - d, y - 11, 2, 3, PAL.gold);
  px(g, ax - d, y + 8, 2, 3, PAL.gold);
  const pullX = chg ? x - d * 3 : x + d * 1;
  seg(g, ax, y - 9, pullX, y, 1, PAL.hi);
  seg(g, ax, y + 9, pullX, y, 1, PAL.hi);
  /* 齿轮绞盘 + 水平导箭滑槽 + 红羽精钢弩箭 */
  const sx0 = d > 0 ? x - 5 : x - 8;
  px(g, sx0, y - 4, 13, 8, PAL.ink);
  px(g, sx0 + 1, y - 3, 11, 6, f ? UNIT_HI : UNIT_TONE.stone[0]);
  px(g, sx0 + 1, y - 3, 11, 3, f ? UNIT_HI : UNIT_TONE.stone[1]);
  px(g, sx0 + 1, y - 3, 11, 1, f ? UNIT_HI : UNIT_TONE.stone[2]);
  px(g, x - 2, y + 2, 4, 4, PAL.ink);
  px(g, x - 1, y + 3, 2, 2, PAL.gold); /* 绞盘齿轮 */
  px(g, d > 0 ? x - 4 : x + 3, y - 2, 2, 4, PAL.red); /* 红羽箭尾 */
  const tipX = d > 0 ? x + 6 : x - 10;
  px(g, tipX, y - 2, 4, 4, PAL.ink);
  px(g, tipX + (d > 0 ? 0 : 1), y - 1, 3, 2, chg ? PAL.red : PAL.gold);
  px(g, tipX + (d > 0 ? 2 : 0), y - 1, 2, 2, PAL.hi);
}
/* 场地机关渲染：地刺 / 火口 / 回旋锯 / 落石 */
function drawTrap(g, tp) {
  if (tp.kind === 'spike') {
    const x0 = Math.round(tp.x0), w = Math.round(tp.x1 - tp.x0), y = sy(tp.y);
    if (y < -40 || y > CFG.H + 40) return;
    /* 铆钉黄黑警示铁槽底座 */
    px(g, x0 - 2, y - 3, w + 4, 5, PAL.ink);
    px(g, x0 - 1, y - 2, w + 2, 3, PAL.stone);
    px(g, x0 - 1, y - 2, w + 2, 1, PAL.stone3);
    for (let hx = x0 + 1; hx < x0 + w - 2; hx += 6) px(g, hx, y, 3, 1, PAL.gold2);
    px(g, x0, y - 2, 2, 2, PAL.gold); px(g, x0 + w - 2, y - 2, 2, 2, PAL.gold);
    for (let i = 0; i < 4; i++) {
      const sx = x0 + 4 + i * 8;
      px(g, sx - 2, y - 2, 4, 2, PAL.ink);
      if (tp.phase === 'warn') {
        const jx = (S.frames >> 1) % 2 === 0 ? -1 : 1;
        px(g, sx - 3 + jx, y - 6, 6, 5, PAL.ink);
        px(g, sx - 2 + jx, y - 5, 4, 4, (S.frames >> 1) % 2 === 0 ? PAL.red : PAL.gold);
        px(g, sx - 1 + jx, y - 7, 2, 5, PAL.hi);
      } else if (tp.phase === 'on') {
        /* 阶梯三角双面精钢刺刃 + 淬血锋尖 */
        px(g, sx - 4, y - 6, 8, 5, PAL.ink);
        px(g, sx - 3, y - 11, 6, 10, PAL.ink);
        px(g, sx - 2, y - 15, 4, 14, PAL.ink);
        px(g, sx - 3, y - 5, 3, 4, PAL.stone3);
        px(g, sx, y - 5, 3, 4, PAL.stone);
        px(g, sx - 2, y - 10, 2, 9, PAL.hi);
        px(g, sx, y - 10, 2, 9, PAL.stone2);
        px(g, sx - 1, y - 14, 2, 4, PAL.red);
        px(g, sx - 1, y - 15, 1, 2, '#ffffff');
      }
    }
  } else if (tp.kind === 'flame') {
    const x = Math.round(tp.x), y = sy(tp.y);
    if (y < -60 || y > CFG.H + 60) return;
    /* 阶梯铸铜喷火炉座 + 散热格栅 + 金铆钉 */
    px(g, x - 11, y - 3, 22, 4, PAL.ink);
    px(g, x - 9, y - 6, 18, 6, PAL.ink);
    px(g, x - 10, y - 2, 20, 2, '#6e381d');
    px(g, x - 8, y - 5, 16, 4, '#99522c');
    px(g, x - 7, y - 5, 14, 1, PAL.gold);
    for (const gx of [-5, -1, 3]) px(g, x + gx, y - 4, 2, 3, tp.phase === 'off' ? PAL.ink : PAL.red);
    px(g, x - 9, y - 2, 1, 1, PAL.gold); px(g, x + 8, y - 2, 1, 1, PAL.gold);
    if (tp.phase === 'warn') {
      const pulse = 0.45 + 0.35 * Math.sin(S.t * 28);
      g.fillStyle = 'rgba(224,60,49,' + pulse.toFixed(2) + ')';
      g.fillRect(x - 9, y - 12, 18, 8);
      const fl = (S.frames >> 1) % 3;
      px(g, x - 5, y - 9 - fl, 4, 4, PAL.red);
      px(g, x + 1, y - 11 + fl, 4, 5, PAL.gold);
      px(g, x - 1, y - 8, 3, 3, PAL.hi);
    } else if (tp.phase === 'on') {
      g.fillStyle = 'rgba(224,60,49,0.22)';
      g.fillRect(x - 15, y - 58, 30, 54);
      for (let k = 0; k < 8; k++) {
        const fy = y - 10 - k * 6.5;
        const sway = Math.round(Math.sin(S.t * 32 + k * 0.9) * (k > 2 ? 2.4 : 1));
        const rw = Math.max(5, 17 - k * 1.4);
        const gw = Math.max(3, 11 - k * 1.1);
        px(g, Math.round(x + sway - rw / 2), Math.round(fy), Math.round(rw), 8, k > 5 ? PAL.red2 : PAL.red);
        px(g, Math.round(x + sway - gw / 2), Math.round(fy) + 1, Math.round(gw), 6, PAL.gold);
        if (k < 5) px(g, x + sway - 2, Math.round(fy) + 2, 4, 4, PAL.hi);
      }
    }
  } else if (tp.kind === 'saw') {
    const y = sy(tp.y);
    if (y < -40 || y > CFG.H + 40) return;
    const x0 = Math.round(tp.x0), x1 = Math.round(tp.x1), x = Math.round(tp.x);
    /* 精密导轨暗槽与两端黄铜缓冲座 */
    px(g, x0 - 5, y - 3, x1 - x0 + 10, 5, PAL.ink);
    px(g, x0 - 3, y - 2, x1 - x0 + 6, 3, PAL.stone);
    px(g, x0 - 2, y - 1, x1 - x0 + 4, 1, PAL.ink);
    px(g, x0 - 4, y - 3, 3, 4, PAL.gold2); px(g, x0 - 3, y - 2, 1, 2, PAL.gold);
    px(g, x1 + 1, y - 3, 3, 4, PAL.gold2); px(g, x1 + 2, y - 2, 1, 2, PAL.gold);
    /* 旋转弯齿精钢锯盘 */
    const cy = y - 2, r = 10;
    g.save();
    g.translate(x, cy);
    g.rotate(tp.spin || 0);
    for (let i = 0; i < 8; i++) {
      g.save();
      g.rotate(i * Math.PI / 4);
      px(g, -2, -r - 3, 5, 4, PAL.ink);
      px(g, -1, -r - 2, 3, 3, PAL.stone3);
      px(g, 0, -r - 3, 2, 2, i % 2 === 0 ? PAL.hi : PAL.red);
      g.restore();
    }
    px(g, -8, -8, 16, 16, PAL.ink);
    px(g, -9, -6, 18, 12, PAL.ink);
    px(g, -6, -9, 12, 18, PAL.ink);
    px(g, -7, -7, 14, 14, PAL.stone3);
    px(g, -6, -6, 5, 2, PAL.hi);
    px(g, -5, -5, 10, 10, PAL.red2);
    px(g, -4, -4, 8, 8, PAL.red);
    px(g, -3, -3, 6, 6, PAL.ink);
    px(g, -2, -2, 4, 4, PAL.gold);
    px(g, -1, -1, 2, 2, PAL.hi);
    g.restore();
  } else if (tp.kind === 'rock') {
    const sx = Math.round(tp.x), yTop = sy(tp.y0);
    if (yTop < -80 || yTop > CFG.H + 100) return;
    /* 顶部多齿钟乳母岩巢座 */
    px(g, sx - 10, yTop - 10, 20, 6, PAL.ink);
    px(g, sx - 9, yTop - 9, 18, 4, PAL.stone);
    px(g, sx - 8, yTop - 9, 16, 1, PAL.stone3);
    px(g, sx - 7, yTop - 5, 3, 3, PAL.stone2);
    px(g, sx + 4, yTop - 5, 3, 3, PAL.stone2);
    if (tp.state === 'gone') return;
    const jx = tp.state === 'warn' ? Math.round(Math.sin(S.t * 48) * 2) : 0;
    const rx = sx + jx, ry = sy(tp.y);
    if (tp.state === 'warn') {
      g.save();
      g.strokeStyle = 'rgba(224,60,49,0.55)';
      g.lineWidth = 1;
      if (g.setLineDash) g.setLineDash([3, 3]);
      g.beginPath(); g.moveTo(sx, ry + 11); g.lineTo(sx, sy(tp.ground)); g.stroke();
      g.restore();
    }
    /* 多切面棱角巨石 + 青苔 + 崩裂红金矿脉 */
    px(g, rx - 9, ry - 7, 18, 13, PAL.ink);
    px(g, rx - 7, ry - 9, 14, 16, PAL.ink);
    px(g, rx - 5, ry + 6, 10, 5, PAL.ink);
    px(g, rx - 2, ry + 10, 4, 4, PAL.ink);
    px(g, rx - 8, ry - 6, 16, 11, PAL.stone);
    px(g, rx - 6, ry - 8, 12, 13, PAL.stone2);
    px(g, rx - 6, ry - 7, 7, 5, PAL.stone3);
    px(g, rx - 5, ry - 7, 4, 2, 'rgba(244,236,220,0.35)');
    px(g, rx + 3, ry - 6, 3, 2, PAL.green2);
    px(g, rx - 4, ry + 5, 8, 4, PAL.stone);
    px(g, rx - 1, ry + 9, 2, 4, tp.state === 'idle' ? PAL.stone2 : PAL.red);
    if (tp.state === 'warn' || tp.state === 'fall') {
      px(g, rx - 2, ry - 4, 4, 8, PAL.red);
      px(g, rx - 4, ry - 1, 8, 2, PAL.red);
      px(g, rx - 1, ry - 2, 2, 5, PAL.gold);
      px(g, rx, ry - 1, 1, 2, PAL.hi);
    }
  }
}
function drawHp(g, m) {
  const max = m.max || (MON_META[m.kind] && MON_META[m.kind].hp) || 20;
  if (m.hp >= max) return;
  const isB = m.kind === 'boss';
  const wide = isB ? 72 : 22, h = isB ? 4 : 3;
  const yOff = isB ? 64 : (m.kind === 'raider' || m.kind === 'sniper' ? 26 : 22);
  const x = Math.round(m.x) - (wide >> 1), y = sy(m.y) - yOff;
  px(g, x - 2, y - 2, wide + 4, h + 4, PAL.ink);
  px(g, x - 1, y - 1, wide + 2, h + 2, isB ? PAL.gold2 : PAL.stone2);
  px(g, x, y, wide, h, PAL.dark);
  const tr = m.hpTrail !== undefined ? Math.max(m.hp, m.hpTrail) : m.hp;
  const tw = Math.max(0, Math.min(wide, Math.round(wide * tr / max)));
  if (tw > 0) px(g, x, y, tw, h, PAL.hi);
  const fw = Math.max(1, Math.min(wide, Math.round(wide * Math.max(0, m.hp) / max)));
  px(g, x, y, fw, h, PAL.red2);
  px(g, x, y, fw, Math.max(1, h - 1), PAL.red);
  px(g, x, y, fw, 1, '#ff9882');
  if (isB) {
    px(g, x - 2, y - 1, 2, h + 2, PAL.gold);
    px(g, x + wide, y - 1, 2, h + 2, PAL.gold);
  }
}
/* 拱顶熟铁包边宝箱 + 黄铜锁扣与高光 */
function drawChest(g, x, y) {
  x = Math.round(x); y = Math.round(y);
  px(g, x - 9, y + 3, 18, 2, 'rgba(0,0,0,0.40)');
  px(g, x - 9, y - 7, 18, 11, PAL.ink);
  px(g, x - 8, y - 9, 16, 13, PAL.ink);
  /* 木箱主体与拱形箱盖 */
  px(g, x - 8, y - 4, 16, 7, '#7a4a24');
  px(g, x - 7, y - 8, 14, 4, '#a6682e');
  px(g, x - 6, y - 8, 12, 1, PAL.gold);
  /* 两侧铁箍包带与铆钉 */
  px(g, x - 6, y - 8, 2, 11, PAL.stone2);
  px(g, x + 4, y - 8, 2, 11, PAL.stone2);
  px(g, x - 8, y - 4, 16, 1, PAL.ink);
  /* 中央黄金锁牌与锁孔 */
  px(g, x - 2, y - 5, 4, 5, PAL.ink);
  px(g, x - 1, y - 4, 2, 3, PAL.gold);
  px(g, x - 1, y - 4, 1, 1, PAL.hi);
}
/* 八角雕纹悬浮符文碑 + 环绕奥术微粒 */
function drawRune(g, x, y, t) {
  x = Math.round(x); y = Math.round(y) + Math.round(Math.sin(t * 3) * 2);
  g.fillStyle = 'rgba(176,124,240,0.20)';
  g.fillRect(x - 7, y - 9, 14, 16);
  px(g, x - 6, y - 6, 12, 10, PAL.ink);
  px(g, x - 4, y - 8, 8, 14, PAL.ink);
  px(g, x - 5, y - 5, 10, 8, PAL.violet3);
  px(g, x - 3, y - 7, 6, 12, PAL.violet2);
  px(g, x - 3, y - 6, 4, 2, PAL.violet);
  /* 阴刻发光古符文 */
  px(g, x - 1, y - 5, 2, 8, PAL.hi);
  px(g, x - 3, y - 3, 6, 1, PAL.cyan);
  px(g, x - 2, y + 1, 4, 1, PAL.cyan);
  const ox = Math.round(Math.cos(t * 4.5) * 6), oy = Math.round(Math.sin(t * 4.5) * 5);
  px(g, x + ox, y + oy, 1, 1, PAL.gold);
}
/* 守门吏 NPC：宽檐斗笠兜帽 + 分层披风腰带 + 木杖 + 轻摆暖金铜提灯 */
function drawNpc(g, x, y, t) {
  x = Math.round(x); y = Math.round(y);
  const bob = Math.round(Math.sin(t * 1.6) * 1);
  const yb = y + bob;
  px(g, x - 10, y - 1, 20, 2, 'rgba(0,0,0,0.38)');
  /* 左手古木长杖 */
  px(g, x - 10, yb - 28, 3, 28, PAL.ink);
  px(g, x - 9, yb - 27, 1, 26, '#8c5d38');
  px(g, x - 10, yb - 29, 3, 2, PAL.gold2);
  /* 分层守塔披风与紫金束腰 */
  px(g, x - 8, yb - 21, 16, 21, PAL.ink);
  px(g, x - 7, yb - 20, 14, 19, PAL.stone);
  px(g, x - 6, yb - 20, 5, 18, PAL.stone2);
  px(g, x - 2, yb - 19, 4, 18, PAL.ink3);
  px(g, x - 7, yb - 10, 14, 2, PAL.gold2);
  px(g, x - 1, yb - 10, 3, 2, PAL.gold);
  /* 面影与微眨青眸 */
  px(g, x - 6, yb - 26, 12, 6, PAL.ink);
  const blink = (Math.floor(t * 2.2) % 9) === 0;
  if (!blink) {
    px(g, x - 3, yb - 24, 2, 2, PAL.cyan);
    px(g, x + 2, yb - 24, 2, 2, PAL.cyan);
    px(g, x - 3, yb - 24, 1, 1, PAL.hi);
  } else {
    px(g, x - 3, yb - 23, 2, 1, PAL.cyan2);
    px(g, x + 2, yb - 23, 2, 1, PAL.cyan2);
  }
  /* 宽檐尖顶斗笠 */
  px(g, x - 11, yb - 28, 22, 3, PAL.ink);
  px(g, x - 7, yb - 31, 14, 3, PAL.ink);
  px(g, x - 3, yb - 33, 6, 2, PAL.ink);
  px(g, x - 10, yb - 27, 20, 1, PAL.stone3);
  px(g, x - 6, yb - 30, 12, 2, PAL.stone2);
  px(g, x - 2, yb - 32, 4, 2, PAL.gold2);
  /* 右手提杆与摇曳暖金风灯 */
  const sw = Math.round(Math.sin(t * 2.6) * 1);
  const lx = x + 9 + sw, ly = yb - 14;
  px(g, x + 6, yb - 17, 5, 2, PAL.ink);
  g.fillStyle = 'rgba(235,179,75,0.16)';
  g.fillRect(lx - 6, ly - 4, 13, 14);
  px(g, lx - 3, ly - 2, 7, 9, PAL.ink);
  px(g, lx - 2, ly - 3, 5, 2, PAL.gold2);
  px(g, lx - 2, ly, 5, 5, PAL.gold);
  px(g, lx - 1, ly + 1, 3, 3, PAL.hi);
  px(g, lx - 2, ly + 5, 5, 1, PAL.gold2);
}
/* 训练木偶：铆钉木桩 + 束带草靶 + 缝线麻布头，受击后上身回弹 */
function drawDummy(g, x, y, flash, m) {
  x = Math.round(x); y = Math.round(y);
  const hit = m.hitT || 0;
  const heavy = m.kbKind === 'launch' ? 1.9 : m.kbKind === 'push' ? 1.45 : 1;
  const baseT = m.kbKind === 'launch' ? 0.42 : m.kbKind === 'push' ? 0.34 : 0.28;
  const elapsed = Math.max(0, baseT - hit);
  const wob = hit > 0 ? Math.round(Math.sin(elapsed * 46) * 2.4 * heavy * Math.min(1, hit / 0.18)) : 0;
  const sway = Math.round(Math.sin((m.t || 0) * 1.4) * 0.9);
  const tw = wob, yT = y + sway;
  const f = flash > 0;
  const wood = f ? '#e0b483' : '#7a5535', woodHi = f ? '#ffe9c9' : '#a37b4e';
  const straw = f ? '#e7c46f' : '#b08428', baleBand = f ? '#c9a54f' : '#8a6420';
  const sack = f ? '#f0d7a8' : '#c9a36a', rope = f ? '#ffefcf' : '#d9b87a';
  /* 底座 + 铁包角 + 投影 */
  px(g, x - 18, y + 22, 36, 3, 'rgba(0,0,0,0.44)');
  px(g, x - 18, y + 15, 36, 8, PAL.ink);
  px(g, x - 16, y + 15, 32, 5, wood);
  px(g, x - 16, y + 15, 32, 1, woodHi);
  px(g, x - 16, y + 20, 32, 2, '#4a3220');
  px(g, x - 15, y + 16, 2, 3, PAL.stone2); px(g, x + 13, y + 16, 2, 3, PAL.stone2);
  /* 立柱与铸铁箍 */
  const pxPost = Math.round(wob * 0.45);
  px(g, x - 4 + pxPost, y - 16, 8, 32, PAL.ink);
  px(g, x - 3 + pxPost, y - 16, 6, 31, wood);
  px(g, x - 2 + pxPost, y - 14, 1, 27, woodHi);
  px(g, x - 3 + pxPost, y + 11, 6, 2, PAL.stone2);
  /* 横臂与两端外露稻草簇 */
  px(g, x - 21 + tw, yT - 13, 42, 5, PAL.ink);
  px(g, x - 20 + tw, yT - 12, 40, 3, wood);
  px(g, x - 20 + tw, yT - 12, 40, 1, woodHi);
  px(g, x - 18 + tw, yT - 8, 4, 3, straw); px(g, x + 14 + tw, yT - 8, 4, 3, straw);
  /* 躯干草靶 */
  px(g, x - 13 + tw, yT - 9, 26, 22, PAL.ink);
  px(g, x - 12 + tw, yT - 8, 24, 20, straw);
  for (let i = 0; i < 3; i++) px(g, x - 12 + tw, yT - 3 + i * 6, 24, 2, baleBand);
  px(g, x - 12 + tw, yT - 8, 24, 2, rope);
  px(g, x - 12 + tw, yT + 9, 24, 2, rope);
  px(g, x - 11 + tw, yT - 6, 2, 16, 'rgba(255,244,214,0.22)');
  /* 靶心 */
  px(g, x - 7 + tw, yT - 5, 14, 14, f ? '#ffe9c9' : PAL.hi);
  px(g, x - 5 + tw, yT - 3, 10, 10, f ? '#ff9a80' : PAL.red2);
  px(g, x - 3 + tw, yT - 1, 6, 6, f ? '#fff4e2' : PAL.hi);
  px(g, x - 1 + tw, yT + 1, 2, 2, f ? '#ff9a80' : PAL.red);
  /* 头套 + 麻布补丁与缝线 */
  px(g, x - 10 + tw, yT - 36, 20, 24, PAL.ink);
  px(g, x - 8 + tw, yT - 38, 16, 3, PAL.ink);
  px(g, x - 9 + tw, yT - 35, 18, 22, sack);
  px(g, x - 7 + tw, yT - 37, 14, 3, rope);
  px(g, x - 8 + tw, yT - 34, 6, 16, 'rgba(255,255,255,0.14)');
  px(g, x + 3 + tw, yT - 33, 4, 4, baleBand); /* 粗布补丁 */
  px(g, x - 5 + tw, yT - 28, 3, 1, PAL.ink); px(g, x - 4 + tw, yT - 29, 1, 3, PAL.ink);
  px(g, x + 2 + tw, yT - 28, 3, 1, PAL.ink); px(g, x + 3 + tw, yT - 29, 1, 3, PAL.ink);
  px(g, x - 4 + tw, yT - 21, 8, 1, PAL.ink);
  for (let i = 0; i < 4; i++) px(g, x - 3 + tw + i * 2, yT - 22, 1, 3, PAL.ink);
  px(g, x - 9 + tw, yT - 18, 18, 2, wood);
  /* 颈绳结 */
  px(g, x - 4 + tw, yT - 15, 8, 6, rope);
  px(g, x - 4 + tw, yT - 15, 8, 1, '#8a6420');
  px(g, x + 2 + tw, yT - 13, 3, 4, baleBand);
}
/* ---------- 四大镇楼 Boss 像素精修绘制（纯正整数像素，严格对齐各自 M_HIT） ---------- */
function drawBossColossus(g, x, y, m) {
  const f = m.flash > 0, ph = m.phase || 1, tt = m.t || S.t || 0;
  const bob = m.dormant ? 0 : Math.round(Math.sin(tt * 2.4) * 2);
  const yb = y + bob;
  const hot = ph >= 2 ? PAL.gold : PAL.cyan;
  const coreCol = ph >= 2 ? PAL.red : PAL.violet;
  /* 石体靠受光面区分背景；移除整块方形光幕，核心与符文仍保留相位颜色。 */
  /* 1. 下摆猎猎飘动的残破暗紫灵幔流苏 */
  for (let i = -3; i <= 3; i++) {
    const sw = m.dormant ? 0 : Math.round(Math.sin(tt * 5 + i * 0.9) * 2);
    const tx = x + i * 10 - 4 + sw, th = 12 + ((Math.abs(i) + 1) % 3) * 4;
    px(g, tx - 1, yb + 34, 10, th + 2, PAL.ink);
    px(g, tx, yb + 34, 8, th, f ? PAL.hi : (i % 2 === 0 ? PAL.violet3 : '#432b70'));
    px(g, tx + 2, yb + 34 + th - 3, 4, 2, PAL.gold2);
  }
  /* 2. 左右错落悬浮的镇塔符文石柱护肩 */
  const lift = m.bstate === 'quake_wind' ? -8 : 0;
  for (const s of [-1, 1]) {
    const py = yb - 34 + lift + (m.dormant ? 0 : Math.round(Math.sin(tt * 3.1 + (s > 0 ? 1.6 : 0)) * 4));
    const px0 = s < 0 ? x - 52 : x + 36;
    px(g, px0, py, 16, 48, PAL.ink);
    px(g, px0 - 2, py + 4, 20, 7, PAL.ink);
    px(g, px0 + 1, py + 1, 14, 46, f ? UNIT_HI : UNIT_TONE.stone[0]);
    px(g, px0 + 1, py + 1, 10, 43, f ? UNIT_HI : UNIT_TONE.stone[1]);
    px(g, px0 + 1, py + 1, 14, 2, f ? UNIT_HI : UNIT_TONE.stone[2]);
    px(g, px0 + 1, py + 3, 2, 34, f ? UNIT_HI : UNIT_TONE.stone[2]);
    px(g, px0, py + 5, 16, 4, PAL.gold2);
    px(g, px0 + 2, py + 39, 12, 4, PAL.gold2);
    px(g, px0 + 6, py + 14, 4, 18, PAL.ink);
    if (!m.dormant) {
      px(g, px0 + 7, py + 15, 2, 16, hot);
      px(g, px0 + 5, py + 21, 6, 2, hot);
    }
  }
  /* 3. 倒角切面玄石重甲主躯 */
  px(g, x - 40, yb - 42, 80, 78, PAL.ink);
  px(g, x - 36, yb - 46, 72, 84, PAL.ink);
  px(g, x - 39, yb - 41, 78, 76, f ? UNIT_HI : UNIT_TONE.stone[0]);
  px(g, x - 35, yb - 45, 70, 82, f ? UNIT_HI : UNIT_TONE.stone[0]);
  px(g, x - 35, yb - 43, 62, 73, f ? UNIT_HI : UNIT_TONE.stone[1]);
  px(g, x - 35, yb - 45, 70, 3, f ? UNIT_HI : UNIT_TONE.stone[2]);
  px(g, x - 39, yb - 41, 4, 63, f ? UNIT_HI : UNIT_TONE.stone[2]);
  /* 左颧骨/鼻梁/下颌的大切面，右侧与腹底留整片暗面；仅两道阶梯石缝。 */
  px(g, x - 35, yb - 38, 7, 40, f ? UNIT_HI : UNIT_TONE.stone[2]);
  px(g, x - 5, yb - 24, 10, 22, f ? UNIT_HI : UNIT_TONE.stone[0]);
  px(g, x - 5, yb - 24, 6, 19, f ? UNIT_HI : UNIT_TONE.stone[2]);
  px(g, x - 30, yb + 29, 56, 3, f ? UNIT_HI : UNIT_TONE.stone[2]);
  px(g, x + 28, yb - 38, 1, 9, PAL.ink);
  px(g, x + 25, yb - 30, 4, 1, PAL.ink);
  px(g, x - 34, yb + 9, 6, 1, PAL.ink);
  px(g, x - 29, yb + 9, 1, 8, PAL.ink);
  /* 额前紫晶护额与黄金铆钉带 */
  px(g, x - 30, yb - 35, 60, 11, PAL.ink);
  px(g, x - 28, yb - 33, 56, 7, f ? PAL.hi : PAL.violet3);
  px(g, x - 26, yb - 33, 52, 2, PAL.violet);
  for (let rx = -22; rx <= 22; rx += 11) px(g, x + rx - 1, yb - 31, 3, 3, PAL.gold);
  /* 4. 三阶黄金城垛镇塔王冠 */
  px(g, x - 26, yb - 51, 52, 6, PAL.ink);
  px(g, x - 24, yb - 49, 48, 4, PAL.gold2);
  px(g, x - 24, yb - 50, 48, 2, PAL.gold);
  for (const [cx0, ch] of [[-20, 8], [-7, 12], [7, 12], [20, 8]]) {
    px(g, x + cx0 - 4, yb - 50 - ch, 8, ch, PAL.ink);
    px(g, x + cx0 - 3, yb - 49 - ch, 6, ch - 1, PAL.gold);
    px(g, x + cx0 - 2, yb - 49 - ch, 2, ch - 2, PAL.hi);
  }
  px(g, x - 5, yb - 59, 10, 9, PAL.ink);
  px(g, x - 3, yb - 57, 6, 5, ph >= 2 ? PAL.red : PAL.cyan);
  px(g, x - 2, yb - 56, 2, 2, PAL.hi);
  /* 5. 深陷石雕怒目 */
  const dx = m.dormant ? 0 : Math.max(-3, Math.min(3, Math.round((P.x - x) / 36)));
  const dy = m.dormant ? 0 : Math.max(-2, Math.min(2, Math.round((sy(P.y) - y) / 48)));
  for (const s of [-1, 1]) {
    const ex = x + s * 16;
    px(g, ex - 9, yb - 21, 18, 13, PAL.ink);
    px(g, ex - 7, yb - 19, 14, 9, '#1a1128');
    px(g, ex - 8, yb - 22 + (s < 0 ? 0 : 1), 16, 3, f ? UNIT_HI : UNIT_TONE.stone[2]);
    if (!m.dormant) {
      px(g, ex - 4 + dx, yb - 17 + dy, 8, 7, PAL.red2);
      px(g, ex - 3 + dx, yb - 16 + dy, 6, 5, PAL.red);
      px(g, ex - 1 + dx, yb - 15 + dy, 3, 3, PAL.gold);
      px(g, ex - 1 + dx, yb - 15 + dy, 1, 1, PAL.hi);
    }
  }
  /* 6. 胸腹镇塔熔炉核心 */
  const pulse = m.dormant ? 0 : Math.round(Math.sin(tt * (4 + ph * 3)) * 2);
  px(g, x - 22, yb + 1, 44, 26, PAL.ink);
  px(g, x - 20, yb + 3, 40, 22, '#150f16');
  px(g, x - 22, yb, 44, 3, PAL.gold2);
  px(g, x - 22, yb + 25, 44, 3, PAL.gold2);
  if (!m.dormant) {
    px(g, x - 14 - pulse, yb + 6, 28 + pulse * 2, 16, ph >= 2 ? PAL.red2 : PAL.violet3);
    px(g, x - 10 - pulse, yb + 8, 20 + pulse * 2, 12, m.bstate === 'furnace' ? PAL.gold : coreCol);
    px(g, x - 5, yb + 11, 10, 6, PAL.gold);
    px(g, x - 2, yb + 12, 4, 4, PAL.hi);
  }
  if (m.bstate !== 'furnace') {
    for (let gx = -14; gx <= 14; gx += 9) {
      px(g, x + gx - 1, yb + 3, 3, 22, PAL.ink);
      px(g, x + gx, yb + 3, 1, 22, PAL.stone2);
    }
  }
}

/* 30F 二号 Boss：赤铠鬼将·修罗（鹿角鬼面兜鍪 + 残破猩红阵羽织 + 妖刀鬼切） */
function drawBossShura(g, x, y, m) {
  const f = m.flash > 0, ph = m.phase || 1, tt = m.t || S.t || 0;
  const d = m.dir || -1;
  const crouch = (m.bstate === 'iaido_wind' || m.bstate === 'iaido_dash') ? 4 : 0;
  const footY = y + 26;
  const yB = y + crouch;

  /* 居合贯穿全场猩红斩击预警线 */
  if (m.bstate === 'iaido_wind' && !m.dormant) {
    const blink = (Math.floor(tt * 24) % 2) === 0;
    g.fillStyle = blink ? 'rgba(224,60,49,0.42)' : 'rgba(235,179,75,0.32)';
    g.fillRect(CFG.wallT, footY - 18, CFG.W - CFG.wallT * 2, 6);
    px(g, CFG.wallT, footY - 16, CFG.W - CFG.wallT * 2, 2, blink ? PAL.hi : PAL.red);
  }
  if (!m.dormant) {
    g.fillStyle = ph >= 2 ? 'rgba(224,60,49,0.18)' : 'rgba(176,124,240,0.12)';
    g.fillRect(x - 28, yB - 30, 56, 58);
  }
  /* 1. 身后猎猎飞舞的猩红残破阵羽织披风 */
  const capeSw = m.dormant ? 0 : Math.round(Math.sin(tt * 8) * 3);
  const cx0 = x - d * 10;
  px(g, cx0 - 12, yB - 12, 24, 30, PAL.ink);
  px(g, cx0 - 10, yB - 10, 20, 26, f ? PAL.hi : '#6e1727');
  px(g, cx0 - 8 - d * 4 + capeSw, yB + 4, 16, 16, f ? PAL.hi : PAL.red2);
  px(g, cx0 - 6 - d * 6 + capeSw, yB + 12, 12, 8, PAL.gold2);
  /* 2. 重装赤漆护胫与跨步战靴 */
  const stride = m.bstate === 'iaido_dash' ? 8 : (m.dormant ? 2 : Math.round(Math.sin(tt * 7) * 4));
  for (const s of [-1, 1]) {
    const lx = x + s * (6 + (s === d ? stride * 0.4 : 0));
    px(g, Math.round(lx) - 4, footY - 12, 8, 12, PAL.ink);
    px(g, Math.round(lx) - 3, footY - 11, 6, 10, f ? PAL.hi : '#231b22');
    px(g, Math.round(lx) - 3, footY - 8, 6, 4, f ? PAL.hi : PAL.red);
    px(g, Math.round(lx) - 4, footY - 3, 8, 3, PAL.gold2);
  }
  /* 3. 赤漆胴丸胸甲与双层大袖肩甲 */
  px(g, x - 14, yB - 14, 28, 28, PAL.ink);
  px(g, x - 12, yB - 12, 24, 24, f ? PAL.hi : '#21171f');
  px(g, x - 11, yB - 10, 22, 14, f ? PAL.hi : PAL.red2);
  px(g, x - 9, yB - 8, 18, 3, PAL.red);
  px(g, x - 11, yB - 3, 22, 2, PAL.gold);
  px(g, x - 12, yB + 4, 24, 6, PAL.gold2);
  /* 左右大袖叠甲 */
  for (const s of [-1, 1]) {
    const sx0 = x + s * 15;
    px(g, sx0 - 5, yB - 13, 10, 15, PAL.ink);
    px(g, sx0 - 4, yB - 12, 8, 13, f ? PAL.hi : PAL.red);
    px(g, sx0 - 4, yB - 12, 8, 3, PAL.gold);
    px(g, sx0 - 4, yB - 6, 8, 2, PAL.ink);
  }
  /* 4. 鹿角鬼面兜鍪 */
  px(g, x - 12, yB - 28, 24, 16, PAL.ink);
  px(g, x - 14, yB - 20, 28, 5, PAL.ink);
  px(g, x - 10, yB - 26, 20, 13, f ? PAL.hi : '#231c38');
  unitLitTop(g, x - 10, yB - 26, 20); /* 统一左上受光边 */
  px(g, x - 12, yB - 19, 24, 3, PAL.red2);
  /* 高耸赤金双鹿角前立 */
  for (const s of [-1, 1]) {
    px(g, x + s * 8 - 2, yB - 38, 4, 11, PAL.ink);
    px(g, x + s * 12 - 2, yB - 35, 4, 6, PAL.ink);
    px(g, x + s * 8 - 1, yB - 37, 2, 10, PAL.gold);
    px(g, x + s * 11 - 1, yB - 34, 3, 4, PAL.gold);
    px(g, x + s * 8 - 1, yB - 37, 1, 3, PAL.hi);
  }
  px(g, x - 3, yB - 30, 6, 5, PAL.red);
  px(g, x - 1, yB - 29, 2, 3, PAL.gold);
  /* 白骨獠牙鬼面与凶光双目 */
  px(g, x - 8, yB - 22, 16, 9, '#161124');
  if (!m.dormant) {
    px(g, x + d * 2 - 6, yB - 20, 4, 3, PAL.gold);
    px(g, x + d * 2 + 2, yB - 20, 4, 3, PAL.gold);
    px(g, x + d * 2 - 5, yB - 20, 2, 2, PAL.hi);
    px(g, x + d * 2 + 3, yB - 20, 2, 2, PAL.hi);
  }
  px(g, x - 5, yB - 15, 2, 3, PAL.hi);
  px(g, x + 3, yB - 15, 2, 3, PAL.hi);

  /* 5. 妖刀「鬼切」姿态（蓄力居合 / 高举跳劈 / 挥斩突进） */
  if (m.bstate === 'iaido_wind') {
    const hiltX = x - d * 6, hiltY = yB - 1;
    px(g, hiltX - 10, hiltY - 1, 20, 4, PAL.ink);
    px(g, hiltX - 9, hiltY, 18, 2, PAL.violet);
    /* 刀锷耀眼十字寒芒 */
    px(g, x + d * 6 - 9, hiltY - 1, 18, 2, PAL.hi);
    px(g, x + d * 6 - 1, hiltY - 9, 2, 18, PAL.hi);
    px(g, x + d * 6 - 4, hiltY - 4, 8, 8, PAL.gold);
  } else if (m.bstate === 'helldive_air') {
    /* 滞空双手高举烈焰太刀 */
    px(g, x - 3, yB - 54, 6, 30, PAL.ink);
    px(g, x - 2, yB - 52, 4, 26, PAL.red);
    px(g, x - 1, yB - 52, 2, 24, PAL.hi);
    px(g, x - 5, yB - 26, 10, 3, PAL.gold);
  } else {
    /* 向前斜指修长妖刀 + 紫焰刀气 */
    const bx = d > 0 ? x + 8 : x - 36;
    px(g, bx - 1, yB - 4, 30, 5, PAL.ink);
    px(g, d > 0 ? x + 6 : x - 10, yB - 6, 4, 9, PAL.gold);
    px(g, bx, yB - 3, 28, 3, f ? PAL.hi : (ph >= 2 ? PAL.violet : PAL.stone3));
    px(g, bx + (d > 0 ? 4 : 2), yB - 3, 22, 1, PAL.hi);
    if (!m.dormant) px(g, bx + (d > 0 ? 10 : 6), yB - 5, 10, 1, PAL.red);
  }
}

/* 45F 三号 Boss：冥灯司命·幽烛（白骨朱砂狐面 + 暗紫阴阳法袍 + 五盏旋转幽冥魂灯轮） */
function drawBossLantern(g, x, y, m) {
  const f = m.flash > 0, ph = m.phase || 1, tt = m.t || S.t || 0;
  const bob = m.dormant ? 0 : Math.round(Math.sin(tt * 2.8) * 3);
  const yb = y + bob;

  /* 1. 背后公转的五盏青紫幽冥魂灯法轮 */
  const lampCnt = 5;
  const rad = 32 + (m.bstate === 'spiral' ? 5 : 0);
  for (let i = 0; i < lampCnt; i++) {
    const ang = tt * (ph >= 2 ? 2.4 : 1.5) + (i * Math.PI * 2 / lampCnt);
    const lx = Math.round(x + Math.cos(ang) * rad);
    const ly = Math.round(yb - 4 + Math.sin(ang) * (rad * 0.72));
    if (!m.dormant) {
      g.fillStyle = i % 2 === 0 ? 'rgba(72,201,176,0.20)' : 'rgba(176,124,240,0.20)';
      g.fillRect(lx - 7, ly - 7, 14, 14);
    }
    px(g, lx - 4, ly - 5, 8, 10, PAL.ink);
    px(g, lx - 5, ly - 4, 10, 2, PAL.gold2);
    px(g, lx - 3, ly - 2, 6, 5, m.dormant ? PAL.stone : (i % 2 === 0 ? PAL.cyan : PAL.violet));
    if (!m.dormant) px(g, lx - 1, ly - 1, 2, 3, PAL.hi);
    px(g, lx - 2, ly + 4, 4, 2, PAL.gold2);
  }

  /* 2. 悬浮暗紫镶金宽袖阴阳道袍与幽火下摆 */
  for (let i = -2; i <= 2; i++) {
    const sw = m.dormant ? 0 : Math.round(Math.sin(tt * 4.5 + i) * 2);
    px(g, x + i * 7 - 3 + sw, yb + 18, 7, 11 - Math.abs(i) * 2, PAL.ink);
    px(g, x + i * 7 - 2 + sw, yb + 18, 5, 9 - Math.abs(i) * 2, f ? PAL.hi : (i % 2 === 0 ? PAL.cyan : PAL.violet3));
  }
  /* 宽大法袖张开 */
  px(g, x - 22, yb - 10, 44, 20, PAL.ink);
  px(g, x - 20, yb - 8, 40, 16, f ? PAL.hi : '#2c1e4a');
  unitLitTop(g, x - 20, yb - 8, 40); /* 统一左上受光边 */
  px(g, x - 20, yb + 5, 40, 3, PAL.gold2);
  /* 道袍主躯与金纹绶带 */
  px(g, x - 13, yb - 14, 26, 34, PAL.ink);
  px(g, x - 11, yb - 12, 22, 30, f ? PAL.hi : '#3a2663');
  px(g, x - 4, yb - 10, 8, 28, f ? PAL.hi : PAL.violet3);
  px(g, x - 5, yb - 10, 1, 28, PAL.gold);
  px(g, x + 4, yb - 10, 1, 28, PAL.gold);
  px(g, x - 11, yb + 2, 22, 3, PAL.gold2);

  /* 3. 右侧招魂铜铃幡杖 */
  const sx0 = x + 18;
  px(g, sx0 - 1, yb - 28, 4, 48, PAL.ink);
  px(g, sx0, yb - 27, 2, 46, '#7a5033');
  px(g, sx0 - 4, yb - 30, 10, 5, PAL.gold);
  px(g, sx0 + 3, yb - 25, 4, 12, PAL.cyan);
  px(g, sx0 + 4, yb - 24, 2, 8, PAL.hi);

  /* 4. 巫祝白骨朱砂狐面具 */
  px(g, x - 11, yb - 30, 22, 18, PAL.ink);
  /* 尖狐耳 */
  px(g, x - 10, yb - 36, 6, 7, PAL.ink); px(g, x + 4, yb - 36, 6, 7, PAL.ink);
  px(g, x - 9, yb - 35, 4, 6, f ? PAL.hi : '#eae4ff'); px(g, x + 5, yb - 35, 4, 6, f ? PAL.hi : '#eae4ff');
  px(g, x - 8, yb - 34, 2, 4, PAL.red); px(g, x + 6, yb - 34, 2, 4, PAL.red);
  /* 面具本体与朱砂纹 */
  px(g, x - 9, yb - 28, 18, 14, f ? PAL.hi : '#f0ecff');
  px(g, x - 1, yb - 27, 2, 6, PAL.red);
  px(g, x - 8, yb - 19, 4, 2, PAL.red); px(g, x + 4, yb - 19, 4, 2, PAL.red);
  /* 弯月妖瞳 */
  px(g, x - 7, yb - 23, 5, 3, PAL.ink); px(g, x + 2, yb - 23, 5, 3, PAL.ink);
  if (!m.dormant) {
    px(g, x - 6, yb - 22, 3, 2, ph >= 2 ? PAL.gold : PAL.cyan);
    px(g, x + 3, yb - 22, 3, 2, ph >= 2 ? PAL.gold : PAL.cyan);
  }
}

/* 60F 四号 Boss：千机魔眼·天枢（旋转八齿黄金星盘齿轮 + 棱镜巨瞳 + 子母浮游机关炮） */
function drawBossOcular(g, x, y, m) {
  const f = m.flash > 0, ph = m.phase || 1, tt = m.t || S.t || 0;
  const bob = m.dormant ? 0 : Math.round(Math.sin(tt * 3.0) * 2);
  const yb = y + bob;

  if (!m.dormant) {
    g.fillStyle = m.bstate === 'laser_fire' ? 'rgba(224,60,49,0.22)' : 'rgba(72,201,176,0.14)';
    g.fillRect(x - 36, yb - 36, 72, 72);
  }

  /* 1. 左右两翼悬浮跟瞄的子母浮游机关炮 */
  for (const s of [-1, 1]) {
    const wy = yb + Math.round(Math.sin(tt * 4 + (s > 0 ? 1.5 : 0)) * 4);
    const wx = x + s * 36;
    px(g, wx - 6, wy - 8, 12, 16, PAL.ink);
    px(g, wx - 5, wy - 7, 10, 14, f ? PAL.hi : PAL.gold2);
    px(g, wx - 4, wy - 6, 8, 4, PAL.gold);
    px(g, wx - 3, wy, 6, 5, '#16111a');
    if (!m.dormant) px(g, wx - 2, wy + 1, 4, 3, ph >= 2 ? PAL.red : PAL.cyan);
    px(g, wx - 2, wy + 7, 4, 4, PAL.stone3);
  }

  /* 2. 外圈旋转八齿黄铜精密齿轮星盘 */
  const rotStep = m.dormant ? 0 : (Math.floor(tt * 8) % 2);
  for (let i = 0; i < 8; i++) {
    const ang = i * Math.PI / 4 + rotStep * (Math.PI / 8);
    const gx = Math.round(x + Math.cos(ang) * 26);
    const gy = Math.round(yb + Math.sin(ang) * 26);
    px(g, gx - 4, gy - 4, 8, 8, PAL.ink);
    px(g, gx - 3, gy - 3, 6, 6, f ? PAL.hi : PAL.gold2);
    px(g, gx - 2, gy - 2, 4, 3, PAL.gold);
  }

  /* 3. 八角玄铁重装外环与四角灵晶铆钉 */
  px(g, x - 24, yb - 20, 48, 40, PAL.ink);
  px(g, x - 20, yb - 24, 40, 48, PAL.ink);
  px(g, x - 22, yb - 18, 44, 36, f ? PAL.hi : PAL.stone);
  px(g, x - 18, yb - 22, 36, 44, f ? PAL.hi : PAL.stone2);
  px(g, x - 18, yb - 22, 36, 4, PAL.gold);
  unitLitTop(g, x - 18, yb - 22, 36); /* 统一左上受光边 */
  px(g, x - 18, yb + 18, 36, 4, PAL.gold2);
  for (const [cx0, cy0] of [[-16, -16], [14, -16], [-16, 14], [14, 14]]) {
    px(g, x + cx0, yb + cy0, 3, 3, PAL.cyan);
  }

  /* 4. 中央深渊眼腔与同心棱镜竖瞳 */
  px(g, x - 16, yb - 14, 32, 28, PAL.ink);
  px(g, x - 14, yb - 12, 28, 24, '#0e0a10');
  if (m.dormant) {
    /* 休眠闭合装甲眼睑 */
    px(g, x - 14, yb - 2, 28, 4, PAL.gold2);
    return;
  }
  const angAim = m.aimAng !== undefined ? m.aimAng : Math.atan2(P.y - (m.y || 0), P.x - x);
  const pxOff = Math.round(Math.cos(angAim) * 4);
  const pyOff = Math.round(Math.sin(angAim) * 3);
  const hotLaser = m.bstate === 'laser_wind' || m.bstate === 'laser_fire';
  px(g, x - 9 + pxOff, yb - 9 + pyOff, 18, 18, hotLaser ? PAL.red2 : (ph >= 2 ? '#6e1d35' : '#1b4965'));
  px(g, x - 7 + pxOff, yb - 7 + pyOff, 14, 14, hotLaser ? PAL.red : (ph >= 2 ? PAL.gold : PAL.cyan));
  px(g, x - 2 + pxOff, yb - 6 + pyOff, 4, 12, PAL.ink);
  px(g, x - 1 + pxOff, yb - 4 + pyOff, 2, 8, hotLaser ? PAL.hi : PAL.gold);
  px(g, x - 5 + pxOff, yb - 5 + pyOff, 3, 3, PAL.hi);
}

function drawBossHeart(g, x, y, m) {
  x = Math.round(x); y = Math.round(y);
  const f = m.flash > 0;
  const pulse = Math.round(Math.sin(m.t * (m.phase >= 3 ? 6.2 : 3.4)) * (3 + m.phase));
  const c1 = f ? PAL.hi : '#d94a7a';
  const c2 = f ? PAL.hi : '#8f2148';
  const c3 = f ? PAL.hi : '#5b142f';
  g.fillStyle = 'rgba(217,74,122,' + (0.10 + (m.phase >= 3 ? 0.05 : 0)) + ')';
  g.beginPath(); g.arc(x, y, 70 + pulse * 3, 0, Math.PI * 2); g.fill();
  /* 上双心房 */
  px(g, x - 38, y - 48 - pulse, 32, 34, PAL.ink);
  px(g, x + 6, y - 48 - pulse, 32, 34, PAL.ink);
  px(g, x + 8, y - 44 - pulse, 26, 29, c3);
  px(g, x - 34, y - 44 - pulse, 26, 29, c3);
  px(g, x - 31, y - 41 - pulse, 19, 18, c2);
  px(g, x + 12, y - 41 - pulse, 19, 18, c2);
  /* 主心室 */
  px(g, x - 44, y - 22, 88, 66, PAL.ink);
  px(g, x - 40, y - 27, 80, 68, PAL.ink);
  px(g, x - 36, y - 25, 72, 64, c3);
  px(g, x - 30, y - 22, 60, 54, c2);
  px(g, x - 20, y - 18, 40, 42, c1);
  px(g, x - 12, y - 15, 24, 30, '#f07a9c');
  /* 心尖与动脉 */
  px(g, x - 15, y + 39, 30, 12, PAL.ink);
  px(g, x - 11, y + 43, 22, 12, c3);
  px(g, x - 7, y + 49, 14, 8, c2);
  px(g, x - 3, y - 58 - pulse, 6, 18, PAL.ink);
  px(g, x - 1, y - 56 - pulse, 2, 14, c1);
  px(g, x - 1, y - 61 - pulse, 2, 5, PAL.gold);
  /* 冠状动脉 */
  for (const [dx, dy, len, vx] of [[-8, -10, 37, 1], [9, -6, 32, -1], [-22, 12, 18, 1], [22, 10, 20, -1]]) {
    for (let i = 0; i < len; i += 4) px(g, x + dx + Math.round(i * vx * 0.25), y + dy + i, 2, 4, i % 8 ? '#f6a2b8' : '#6b102e');
  }
  /* 心室锁印与阶段裂纹 */
  px(g, x - 15, y - 2, 30, 26, PAL.ink);
  px(g, x - 12, y + 1, 24, 20, '#2a0a16');
  px(g, x - 8, y + 4, 16, 3, m.phase >= 2 ? PAL.gold : c1);
  px(g, x - 5, y + 10, 10, 9, c1);
  px(g, x - 2, y + 12, 4, 5, PAL.hi);
  if (m.phase >= 2) {
    for (let i = 0; i < 4; i++) px(g, x - 30 + i * 16, y + 22 + (i % 2) * 6, 2, 12, PAL.gold);
  }
  if (m.phase >= 3) {
    for (let i = 0; i < 6; i++) px(g, x - 36 + i * 13, y + 34, 8, 2, PAL.red);
  }
  /* 两侧搏动血管 */
  const sway = Math.round(Math.sin(m.t * 2.7) * 4);
  for (const side of [-1, 1]) {
    const bx = x + side * 48;
    for (let i = 0; i < 5; i++) px(g, bx + side * i * 4, y - 18 + i * 9 + sway, 6, 8, PAL.ink);
    px(g, bx + side * 18, y + 26 + sway, 5, 5, c1);
  }
}
function drawBoss(g, x, y, m) {
  x = Math.round(x); y = Math.round(y);
  const bk = m.bkind || 'colossus';
  if (bk === 'shura') drawBossShura(g, x, y, m);
  else if (bk === 'lantern') drawBossLantern(g, x, y, m);
  else if (bk === 'ocular') drawBossOcular(g, x, y, m);
  else if (bk === 'heart') drawBossHeart(g, x, y, m);
  else drawBossColossus(g, x, y, m);
}
/* ---------- 世界 ---------- */
let seed = 20261105;
function rng() { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }
/* 今日之塔：按北京时间（UTC+8）零点刷新。同日同种子＝同一栋楼，跨日换楼；
   每天可多次挑战，只记录当日最佳（本机档案，无线上排行）。 */
function dailyParts() {
  const d = new Date(Date.now() + 8 * 3600 * 1000); // 平移到北京时间，再取 UTC 日历字段
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, day = d.getUTCDate();
  const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const p2 = n => String(n).padStart(2, '0');
  return { y, m, day, key: y * 10000 + m * 100 + day, mon: MON[m - 1], dd: p2(day), str: y + '.' + p2(m) + '.' + p2(day) };
}
function dailyKey() { return dailyParts().key; }
function dailySeed() { return dailyParts().key; }
function dailyBest() { const r = S.meta && S.meta.dailyRec; return (r && r[dailyKey()]) || 0; }

const S = {
  t: 0, frames: 0, floors: new Map(), monsters: [], shots: [], eshots: [], eblasts: [], traps: [], trainTrap: null, parts: [], orbs: [], trails: [],
  collapseY: 0, collapseOn: false, cam: 0, shake: 0, shakeT: 0, flash: 0, hitstop: 0,
  deaths: 0, kills: 0, xp: 0, combo: 0, comboT: 0, checkpoint: { floor: 0, x: 60, y: 0 },
  deathT: -1, deathFrame: 0, restartFrames: 0, autoAttack: false, errors: [], fps: 60, embers: 0,
  lastDeath: null, deathCounts: {},
  chests: [], pickups: [], npcs: [], boss: null, arena: null, arenaHazards: [], bossDone: {},
  bossRewardOpen: false, bossRewards: [], bossKills: 0, bossPenaltyT: 0, heartMarks: 0, heartRule: null, emberShield: false, dodgeCdMul: 1, trainBossIdx: 0,
  freezeT: 0, collapseMul: 1,
  score: 0, coins: 0, panel: false, paused: false, lampSlow: false,
  screen: 'menu', mode: 'endless', difficulty: 'normal', timer: 0, banner: null, toasts: [], hit: [], helpOpen: false,
  shopOpen: false, lastGate: -1, rule: null, ruleMul: 1, dark: false, richZone: false, showHit: false, menuPage: 'home', training: false, trainTab: 'weapons', trainToolsOpen: false, guideOpen: false, guidePage: 0,
  settingsOpen: false, settingsTab: 'music', keyCapture: null, bindingError: '', settingsFrom: 'menu',
  hall: false, hallNear: -1, hallCam: 0, hallLock: 0,
  tut: { on: false, step: 0, t: 0, stepT: 0, moved: false, jumped: false, attacked: false, dj: false, dodged: false, tDone: false, hintCd: 0 },
  pact: null,
  deadPending: null, deathReason: null, runMarks: 0, reviveUsed: false, finalNewRecord: false,
  hitsTaken: 0, lastDamage: null,
  floorKills: {}, lastFloorSeen: 0, bestThisRun: 0, newBestBonus: false, shards: 0, drops: [], lean: 0, idleT: 0,
  loadout: null, pendingWeapon: null,
  meta: metaDefault(),
};
/* ---------- 元进度（localStorage） ---------- */
function metaDefault() {
  return { marks: 0, hammer: false, orb: false, slot: false, revive: false, ember: false,
    best: 0, bestEndless: 0, bestLimited: 0, bestDaily: 0, dailyRec: {}, hints: {},
    sound: true, bgm: true, soundVolume: 1, bgmVolume: 1, noviceGrant: false, recordTier: 0, heartClears: 0, difficulty: 'normal',
    killBest: 0, runeBest: 0, totalKills: 0, loadout: null, bindings: {}, controlMode: 'auto' };
}
function loadMeta() {
  try {
    const m = JSON.parse(localStorage.getItem('glou_meta') || 'null');
    if (m && typeof m === 'object') {
      const out = Object.assign(metaDefault(), m);
      out.soundVolume = audioVolume(out.soundVolume);
      out.bgmVolume = audioVolume(out.bgmVolume);
      if (!('bestEndless' in m)) out.bestEndless = m.best || 0;
      if (!out.dailyRec || typeof out.dailyRec !== 'object') out.dailyRec = {};
      if (!out.hints || typeof out.hints !== 'object') out.hints = {};
      if (!out.bindings || typeof out.bindings !== 'object') out.bindings = {};
      if (!['auto', 'keyboard', 'touch'].includes(out.controlMode)) out.controlMode = 'auto';
      return out;
    }
  } catch (e) {}
  return metaDefault();
}
function saveMeta() { try { localStorage.setItem('glou_meta', JSON.stringify(S.meta)); } catch (e) {} }
/* ---------- 成就：印记解锁的前置条件（先达成，才可用印记献祭） ---------- */
function metaBest() { return Math.max(S.meta.best || 0, S.meta.bestEndless || 0, S.meta.bestLimited || 0, S.meta.bestDaily || 0); }
const ACH = {
  hammer: { name: '屠夫之手', unit: '单局击杀', goal: 20, val: () => S.meta.killBest || 0 },
  orb:    { name: '塔尖回响', unit: '最高到达', goal: 20, unit2: '层', val: () => metaBest() },
  slot:   { name: '秘符学徒', unit: '单局符文', goal: 3, val: () => S.meta.runeBest || 0 },
  revive: { name: '不屈之魂', unit: '最高到达', goal: 35, unit2: '层', val: () => metaBest() },
};
function achInfo(k) {
  const a = ACH[k]; if (!a) return null;
  const v = Math.min(a.goal, a.val());
  return { key: k, name: a.name, unit: a.unit, unit2: a.unit2 || '', val: v, goal: a.goal, done: v >= a.goal, p: v / a.goal };
}
function achDone(k) { const a = ACH[k]; return a ? a.val() >= a.goal : true; }
S.meta = loadMeta();
loadBindings();
/* 首访不再整页弹说明：改由首局分阶段教学逐条引导，完整说明仍在菜单「秘典卷轴」与 H 键 */

const RULES = [
  { id: 'noBlue', text: '别踩蓝的', mech: '蓝色台阶会咬人（-15）' },
  { id: 'fast', text: '影子比你快', mech: '本区崩落加快 30%' },
  { id: 'fragile', text: '这层是纸糊的', mech: '台阶踩两次就塌' },
  { id: 'dark', text: '别回头', mech: '视野只剩脚下' },
  { id: 'rich', text: '楼心情不错', mech: '金币翻倍，多一个宝箱' },
];
const TOAST_ACTIVE = 2, TOAST_LIMIT = 8;
function toast(txt, c) {
  txt = String(txt).trim();
  if (!txt) return false;
  const same = S.toasts.find(t => t.txt === txt);
  if (same) { same.count = Math.min(99, (same.count || 1) + 1); return true; }
  // 保留正在阅读与已排队的提示；满额不挤走旧提示，重复也不延长寿命。
  if (S.toasts.length >= TOAST_LIMIT) return false;
  S.toasts.push({ txt, c: c || PAL.hi, t: Math.min(5, Math.max(2.2, txt.length * 0.09)), count: 1, shown: false });
  return true;
}
function hudToastsVisible() {
  return S.screen === 'playing' && !S.hall && !S.paused && !S.shopOpen && !S.bossRewardOpen && !S.panel && !S.helpOpen && !S.settingsOpen && !S.guideOpen && !S.loadout && !(S.training && S.trainToolsOpen);
}
function tickToasts(dt) {
  if (!hudToastsVisible()) return;
  // 只给本帧开始时的活动提示减寿；队列晋升后必须先绘制再计时。
  for (const t of S.toasts.slice(0, TOAST_ACTIVE)) if (t.shown) t.t -= dt;
  S.toasts = S.toasts.filter(t => t.t > 0);
}
/* 一次性情境提示：同 key 终生只出现一次（存 meta.hints） */
function hintOnce(key, txt, c) {
  S.meta.hints = S.meta.hints || {};
  if (S.meta.hints[key] || !toast(txt, c || PAL.gold)) return false;
  S.meta.hints[key] = true; saveMeta();
  return true;
}
/* 首次装备某类武器时的一次性操作提示（近战点按 / 远程长按），之后靠武器栏常驻提示 */
function weaponHint(slot) {
  if (S.tut && S.tut.on) return false;
  return hintOnce(slot === 0 ? 'melee' : 'ranged',
    slot === 0 ? '近战：点按挥击 · 收招前再按可接下一刀' : '远程：长按连射 · 按住不放持续发射',
    slot === 0 ? PAL.red : PAL.cyan);
}
/* 首局分阶段教学：一次只给一条当前信息，完成操作自动推进；卡住 16s 自动放过，不堵崩落 */
const TUT_STEPS = [
  { id: 'move', title: '① 移动与跳跃', get key() { return bindingLabel('left') + ' / ' + bindingLabel('right') + ' 移动 · ' + bindingLabel('jump') + ' 跳跃'; }, touch: '左摇杆滑动移动 · 上推跳' },
  { id: 'attack', title: '② 出招', get key() { return bindingLabel('attack') + (P.slot === 0 ? ' 点按挥击 · 靠近魔物再出手' : ' 长按连射 · 瞄准魔物'); }, get touch() { return P.slot === 0 ? '点「攻」· 靠近魔物再出手' : '长按「攻」· 连续射击魔物'; } },
];
function tutTick(dt) {
  if (!S.tut || !S.tut.on) return;
  S.tut.t += dt; S.tut.stepT += dt;
  const st = TUT_STEPS[S.tut.step];
  if (!st) { tutFinish(); return; }
  let adv = st.id === 'move' ? (S.tut.moved && S.tut.jumped) : S.tut.attacked;
  if (!adv && S.tut.stepT >= 16) adv = true; // 卡住自动推进，避免教学拖住崩落
  if (adv) {
    S.tut.step++; S.tut.stepT = 0;
    if (S.tut.step >= TUT_STEPS.length) tutFinish();
  }
}
function tutFinish() {
  if (!S.tut || !S.tut.on) return;
  S.tut.on = false; S.tut.tDone = true; S.tut.hintCd = 8;
  S.meta.hints = S.meta.hints || {};
  S.meta.hints.tutDone = true; saveMeta();
  toast(useTouch() ? '基础指引结束 · 点「暂停」可翻阅完整说明' : '基础指引结束 · 按 ' + bindingLabel('help') + ' 可随时翻阅完整说明', PAL.green);
  /* 教学结束再给 3.5s 喘息，然后崩落开始追 */
  S.collapseHoldT = 3.5;
}
/* 进阶招式只在相关情境出现；8s 内只出一条，不向通知队尾堆积过时指令。 */
function tutorialFollowUps(dt) {
  if (!S.tut || S.tut.on || !(S.tut.tDone || (S.meta.hints && S.meta.hints.tutDone)) || S.training || P.dead) return;
  if (S.tut.hintCd === undefined) S.tut.hintCd = 0;
  if (S.tut.hintCd > 0) { S.tut.hintCd -= dt; return; }
  if (S.toasts.length) return;
  if (useTouch() && !S.meta.hints.stick) {
    if (hintOnce('stick', '左摇杆：滑动移动 · 上推跳 · 空中再推二段跳', PAL.cyan)) { S.tut.hintCd = 6; return; }
  }
  const nearbyShot = S.eshots.some(es => Math.abs(es.x - P.x) < 180 && Math.abs(es.y - P.y) < 120);
  const nearbyMonster = S.monsters.some(m => !m.dead && m.kind !== 'dummy' && Math.abs(m.x - P.x) < 100 && Math.abs(m.y - P.y) < 80);
  if (!S.meta.hints.dodge && P.dodgeCd <= 0 && (nearbyShot || nearbyMonster)) {
    if (hintOnce('dodge', (useTouch() ? '点「闪」' : bindingLabel('dodge')) + ' 闪避：短暂无敌，穿过附近攻击', PAL.green)) { S.tut.hintCd = 8; return; }
  }
  if (!S.meta.hints.djump && !P.onGround && P.jumps === 1 && !P.slamming && !P.climbing) {
    if (hintOnce('djump', (useTouch() ? '空中再上推摇杆' : '空中再按 ' + bindingLabel('jump')) + ' · 二段跳跃上高台', PAL.cyan)) { S.tut.hintCd = 8; return; }
  }
  if (!S.meta.hints.slam && !P.onGround && P.vy > 40) {
    for (const m of S.monsters) if (!m.dead && m.kind !== 'dummy' && m.y > P.y + 28 && m.y - P.y < 150 && Math.abs(m.x - P.x) < 60) {
      if (hintOnce('slam', (useTouch() ? '空中下推摇杆' : bindingLabel('slam')) + ' 下砸：空中俯冲砸地，扫中台下魔物', PAL.gold)) { S.tut.hintCd = 8; return; }
      break;
    }
  }
  if (!S.meta.hints.swap && S.eshots.length) {
    for (const es of S.eshots) if (Math.abs(es.x - P.x) < 200 && Math.abs(es.y - P.y) < 160) {
      if (hintOnce('swap', (useTouch() ? '点「' + (P.slot === 0 ? '远程' : '近战') + '」' : bindingLabel('slot')) + ' 切换近战/远程 · 远程长按连射', PAL.cyan)) { S.tut.hintCd = 8; return; }
      break;
    }
  }
}
/* ---------- 出征配置：每局只准带两把（近战 1 + 远程 1） ---------- */
function ownedWeapons() {
  return {
    melee: ['knife', 'long'].concat(S.meta.hammer ? ['hammer'] : []).concat(S.meta.ember ? ['ember'] : []),
    ranged: ['crossbow'].concat(S.meta.orb ? ['orb'] : []),
  };
}
/* 兜底优先级：优先玩家上次的选择，其次短刀 / 连弩，再不行取列表首项 */
function resolveLoadout(pick) {
  const own = ownedWeapons();
  const want = (pick && typeof pick === 'object') ? pick : (S.meta.loadout || {});
  const melee = own.melee.includes(want.melee) ? want.melee : (own.melee.includes('knife') ? 'knife' : own.melee[0]);
  const ranged = own.ranged.includes(want.ranged) ? want.ranged : own.ranged[0];
  return { own: own, weapon: { melee: melee, ranged: ranged } };
}
function loadoutList(col) { const o = ownedWeapons(); return col === 0 ? o.melee : o.ranged; }
function loadoutSlotKey(col) { return col === 0 ? 'melee' : 'ranged'; }
function openLoadout(mode, from) {
  const pick = resolveLoadout(S.meta.loadout).weapon;
  S.loadout = { mode: mode || S.mode || 'endless', from: from || 'menu',
    picks: { melee: pick.melee, ranged: pick.ranged }, col: 0, row: Math.max(0, loadoutList(0).indexOf(pick.melee)) };
  S.screen = 'loadout'; S.paused = false; S.shopOpen = false; S.helpOpen = false;
  S.bossRewardOpen = false; S.panel = false;
  sfx('ui');
  return S.loadout;
}
function cancelLoadout() {
  const L = S.loadout; if (!L) return false;
  S.loadout = null;
  if (L.from === 'hall') S.screen = 'playing';
  else if (L.from === 'dead') S.screen = 'dead';
  else { S.screen = 'menu'; S.menuPage = 'home'; }
  sfx('ui');
  return true;
}
function loadoutMove(dcol, drow) {
  const L = S.loadout; if (!L) return false;
  if (dcol) {
    L.col = (L.col + dcol + 2) % 2;
    L.row = Math.max(0, loadoutList(L.col).indexOf(L.picks[loadoutSlotKey(L.col)]));
  } else if (drow) {
    const arr = loadoutList(L.col);
    L.row = (L.row + drow + arr.length) % arr.length;
    L.picks[loadoutSlotKey(L.col)] = arr[L.row];
  }
  sfx('ui');
  return true;
}
function pickLoadout(key) {
  const L = S.loadout; if (!L || !WEAP[key]) return false;
  const col = WEAP[key].slot === 'melee' ? 0 : 1;
  const arr = loadoutList(col);
  if (!arr.includes(key)) { sfx('deny'); return false; }
  L.col = col; L.row = arr.indexOf(key); L.picks[loadoutSlotKey(col)] = key;
  sfx('ui');
  return true;
}
function confirmLoadout() {
  const L = S.loadout; if (!L) return false;
  const r = resolveLoadout(L.picks);
  S.meta.loadout = { melee: r.weapon.melee, ranged: r.weapon.ranged };
  saveMeta();
  const mode = L.mode;
  S.loadout = null;
  S.pendingWeapon = r.weapon;
  startRun(mode);
  return true;
}
function startRun(mode) {
  S.mode = mode || 'endless'; S.menuPage = 'home'; S.training = false; S.trainTab = 'weapons'; S.hall = false;
  S.difficulty = S.meta.difficulty || S.difficulty || 'normal';
  S.screen = 'playing'; S.deadPending = null; S.deathReason = null; S.reviveUsed = false; S.runMarks = 0;
  S.hitsTaken = 0; S.lastDamage = null; S.finalNewRecord = false;
  seed = S.mode === 'daily' ? dailySeed() : 20261105 + Math.floor(Math.random() * 9999);
  S.floors.clear(); S.floorStart = 0; S.monsters = []; S.chests = []; S.pickups = []; S.npcs = []; S.traps = []; S.trainTrap = null;
  S.shots = []; S.eshots = []; S.eblasts = []; S.parts = []; S.orbs = []; S.trails = []; S_FLOAT.length = 0;
  S.t = 0; S.frames = 0; S.collapseOn = false; S.collapseY = 0; S.collapseHoldT = 0;
  S.shake = 0; S.shakeT = 0; S.flash = 0; S.hitstop = 0; S.combo = 0; S.comboT = 0;
  S.deaths = 0; S.kills = 0; S.xp = 0; S.score = 0; S.coins = 0; S.boss = null;
  S.arena = null; S.arenaHazards = []; S.bossDone = {}; S.bossRewardOpen = false; S.bossRewards = [];
  S.bossKills = 0; S.bossPenaltyT = 0; S.heartMarks = 0; S.heartRule = null; S.emberShield = false; S.dodgeCdMul = 1; S.pendingGate = -1;
  S.freezeT = 0; S.collapseMul = 1; S.deathCounts = {}; S.lastDeath = null;
  S.deathT = -1; S.restartFrames = 0; S.rule = null; S.ruleMul = 1; S.dark = false; S.richZone = false;
  S.shopOpen = false; S.lastGate = -1; S.banner = null; S.toasts = []; S.panel = false; setPaused(false, true);
  S.floorKills = {}; S.lastFloorSeen = 0; S.bestThisRun = 0; S.newBestBonus = false; S.shards = 0; S.drops = []; S.lean = 0; S.idleT = 0;
  S.zone = null;
  /* 首局分阶段教学：完成后写入 meta.hints.tutDone，后续局不再打扰 */
  S.tut = { on: false, step: 0, t: 0, stepT: 0, moved: false, jumped: false, attacked: false, dj: false, dodged: false, tDone: false, hintCd: 0 };
  if (!(S.meta.hints && S.meta.hints.tutDone) && S.mode !== 'limited') S.tut.on = true;
  S.pact = null;
  CFG.hpMax = 100;
  P.hp = 100; P.lv = 1; P.atkMul = 1; P.spdMul = 1; P.runes = []; P.airBonus = 0; P.lastFloor = 0;
  P.dead = false; P.iframe = 0; P.x = CFG.W * 0.25; P.y = -16 - Math.round(P.h / 2) - 1; P.vx = 0; P.vy = 0; P.jumps = 0;
  P.furyT = 0;
  P.slot = 0; P.atkCd = 0; P.atkBuf = 0; P.atkCount = 0; P.slamming = false; P.climbing = false; P.wall = 0;
  P.dodgeT = 0; P.dodgeCd = 0; P.airDodge = false; P.atkPending = null;
  P.sx = 1; P.sy = 1; P.landT = 0; P.skidT = 0; P.hurtT = 0; P.slamT = 0; P.slamLandT = 0; P.sheatheT = 0; P.drawWeapT = 0;
  P.anim = { st: 'idle', t: 0, f: 0, runPhase: 0, atk: 0, atkDur: 0, atkW: 'knife' };
  IN.touch = false; IN.jump = false; IN.jumpHeld = false; IN.atk = false; IN.atkHeld = false; IN.slam = false; IN.slotSwap = false;
  for (const k in keys) keys[k] = false;
  ptr.clear(); syncHoldInputs();
  /* 出征携带：只认玩家在「出征整备」里选定的两把，未选则用上次配置。
     owned 在本局也只保留这两把，E 不能再从仓库里切出第三把。 */
  const lo = resolveLoadout(S.pendingWeapon);
  S.pendingWeapon = null; S.loadout = null;
  P.owned = { melee: [lo.weapon.melee], ranged: [lo.weapon.ranged] };
  P.weapon = { melee: lo.weapon.melee, ranged: lo.weapon.ranged };
  if (S.mode === 'limited') { S.timer = 60; if (!P.runes.includes('climb')) P.runes.push('climb'); } else S.timer = 0;
  CFG.runeSlots = S.meta.slot ? 3 : 2;
  S.checkpoint = { floor: 0, x: CFG.W * 0.25, y: 0 };
  ensureFloors(10);
  S.cam = P.y - CFG.H * CFG.camAnchor;
  S.collapseY = P.y + 160;
  if (!S.tut.on) {
    toast(useTouch() ? '点「暂停」查看操作说明' : '按 ' + bindingLabel('help') + ' 查看操作说明', PAL.mut);
    if (!S.helpOpen) weaponHint(P.slot);
  }
  sfx('start');
  MUS.phaseAt = 0;
  syncTrackA();
  syncMusicDuck();
}
/* ---------- 塔门厅：无怪、无崩落、无时限的一屏房间 ---------- */
const HALL_DOORS = [
  { x: 150, mode: 'endless', name: '无尽之塔', tag: '这楼不给你停下来的机会', c: PAL.cyan, best: 'bestEndless' },
  { x: 360, mode: 'limited', name: '沙漏限时', tag: '一分钟，能爬多高', c: PAL.gold, best: 'bestLimited' },
  { x: 570, mode: 'daily', name: '今日怪谈', tag: '全服同一栋楼 · 零点换梦', c: PAL.violet, best: 'bestDaily' },
];
function startHall() {
  S.screen = 'playing'; S.hall = true; S.training = false; S.menuPage = 'home';
  S.difficulty = S.meta.difficulty || S.difficulty || 'normal';
  S.paused = false; S.panel = false; S.helpOpen = false; S.shopOpen = false;
  S.bossRewardOpen = false; S.bossRewards = []; S.banner = null; S.toasts = [];
  S.hallNear = -1; S.hallLock = 0.9;
  S.mode = 'endless'; S.t = 0; S.frames = 0; S.timer = 0;
  S.collapseOn = false; S.collapseY = 1e9; S.collapseHoldT = 0; S.freezeT = 0;
  S.score = 0; S.coins = 0; S.kills = 0; S.deaths = 0; S.combo = 0; S.lastFloorSeen = 0;
  S.arena = null; S.arenaHazards = []; S.boss = null; S.bossDone = {}; S.pact = null;
  S.monsters = []; S.chests = []; S.pickups = []; S.npcs = []; S.traps = []; S.drops = [];
  S.shots = []; S.eshots = []; S.eblasts = []; S.parts = []; S.orbs = []; S.trails = []; S_FLOAT.length = 0;
  S.floors.clear();
  S.floors.set(0, {
    i: 0, y: 0, wall: null, bossFloor: false, arenaUpper: false,
    plats: [{ x: 0, w: CFG.W, y: 0, type: 'norm', landing: true, floor: 0, steps: 2, warn: false, gone: false }],
  });
  S.floors.set(1, { i: 1, y: -CFG.FH, wall: null, bossFloor: false, arenaUpper: false, plats: [] });
  CFG.hpMax = 100;
  P.hp = 100; P.dead = false; P.iframe = 0; P.x = 72; P.y = -CFG.platT - P.h / 2 - 1;
  P.vx = 0; P.vy = 0; P.onGround = true; P.jumps = 0; P.wall = 0; P.climbing = false;
  P.dodgeT = 0; P.dodgeCd = 0; P.airDodge = false; P.slamming = false; P.atkPending = null; P.atkBuf = 0;
  P.sx = 1; P.sy = 1; P.landT = 0; P.skidT = 0; P.hurtT = 0; P.slamT = 0; P.slamLandT = 0;
  P.anim = { st: 'idle', t: 0, f: 0, runPhase: 0, atk: 0, atkDur: 0, atkW: 'knife' };
  P.runes = [];
  const hlo = resolveLoadout(null);
  P.owned = { melee: [hlo.weapon.melee], ranged: [hlo.weapon.ranged] }; P.weapon = { melee: hlo.weapon.melee, ranged: hlo.weapon.ranged }; P.slot = 0;
  IN.touch = false; IN.jump = false; IN.jumpHeld = false; IN.atk = false; IN.atkHeld = false; IN.slam = false;
  for (const k in keys) keys[k] = false;
  ptr.clear(); syncHoldInputs();
  S.hallCam = -CFG.H * CFG.camAnchor;
  S.cam = S.hallCam;
  toast(useTouch() ? '走到门前，按「进」或点底部提示整备出征' : '走到门前，按 R / F 整备出征', PAL.gold);
  sfx('start');
}
function enterHallDoor(i) {
  const d = HALL_DOORS[i];
  if (!S.hall || !d) return false;
  /* 推门前先进「出征整备」：只带两把，选完才算真正开局 */
  openLoadout(d.mode, 'hall');
  return true;
}
function hallTick(dt) {
  if (!S.hall) return false;
  if (S.hallLock > 0) { S.hallLock -= dt; return false; }
  let near = -1, best = 76;
  for (let i = 0; i < HALL_DOORS.length; i++) {
    const dx = Math.abs(P.x - HALL_DOORS[i].x);
    if (dx < best) { best = dx; near = i; }
  }
  S.hallNear = near;
  return false;
}

function startTraining() {
  startRun('endless');
  S.training = true; S.trainTab = 'weapons'; S.trainToolsOpen = false; S.hall = false;
  S.tut.on = false;
  S.helpOpen = false; S.shopOpen = false; S.panel = false; S.banner = null; S.toasts = []; S.timer = 0;
  S.t = 0; S.frames = 0; S.collapseOn = false; S.collapseY = 1e9; S.dark = false; S.rule = null; S.zone = null;
  const plat = (x, w, y, landing) => ({ x, w, y, type: 'norm', landing: !!landing, floor: 0, steps: 2, warn: false, gone: false });
  S.floors.clear();
  /* 训练场同步采用标准五台对称 Boss 竞技场阶梯：满宽底台 + 左右双翼(+46) + 中央大高台(+96) + 左上/右上高台(+142) */
  S.floors.set(0, {
    i: 0, y: 0, wall: 'L',
    plats: [
      plat(0, CFG.W, 0, true),
      plat(64, 140, -46), plat(CFG.W - 64 - 140, 140, -46),
      plat(CFG.W / 2 - 80, 160, -96),
      plat(72, 120, -142), plat(CFG.W - 72 - 120, 120, -142),
    ],
  });
  S.floors.set(1, { i: 1, y: -96, wall: 'R', plats: [] });
  S.monsters = []; S.chests = []; S.pickups = []; S.npcs = []; S.boss = null; S.arena = null; S.arenaHazards = [];
  S.bossRewardOpen = false; S.bossRewards = []; S.shots = []; S.eshots = []; S.eblasts = []; S.trails = []; S.drops = []; S.orbs = []; S_FLOAT.length = 0;
  P.owned = {
    melee: ['knife', 'long', 'hammer'].concat(S.meta.ember ? ['ember'] : []),
    ranged: ['crossbow', 'orb']
  };
  P.weapon = { melee: S.meta.ember ? 'ember' : 'long', ranged: 'crossbow' }; P.slot = 0;
  P.runes = []; CFG.runeSlots = 2; P.hp = CFG.hpMax = 100; P.lv = 1; P.atkMul = 1; P.spdMul = 1; P.xp = 0;
  P.x = CFG.W * 0.36; P.y = -CFG.platT - P.h / 2 - 1; P.vx = 0; P.vy = 0; P.onGround = true; P.dead = false; P.iframe = 0; P.jumps = 0;
  P.atkCd = 0; P.atkBuf = 0; P.atkCount = 0; P.atkPending = null;
  P.sx = 1; P.sy = 1; P.landT = 0; P.skidT = 0; P.hurtT = 0; P.slamT = 0; P.slamLandT = 0; P.sheatheT = 0; P.drawWeapT = 0;
  P.anim = { st: 'idle', t: 0, f: 0, runPhase: 0, atk: 0, atkDur: 0, atkW: 'knife' };
  const dummy = { kind: 'dummy', x: CFG.W * 0.66, y: -CFG.platT - 23, x0: CFG.W * 0.66, y0: -CFG.platT - 23, hp: 1000, max: 1000, dmg: 0, flash: 0, hitT: 0, dead: false, t: 0 };
  S.dummy = dummy; S.monsters.push(dummy);
  S.trainingStats = { dmg: 0, hits: 0, time: 0, last: 0, marks: [] };
  S.checkpoint = { floor: 0, x: P.x, y: -CFG.platT };
  S.cam = P.y - CFG.H * CFG.camAnchor;
  S.score = 0; S.coins = 0; S.kills = 0; S.deaths = 0; S.combo = 0; S.lastFloorSeen = 0;
  toast('训练场：木偶已就位', PAL.gold);
}
/* ---------- 训练场：武器直选（含已解锁烬铁巨剑） / 召唤新怪试招 / 木偶重置 / 离开 ---------- */
function trainWeaponKeys() {
  const m = ['knife', 'long', 'hammer'];
  if (S.meta.ember && !m.includes('ember')) m.push('ember');
  return [...m, 'crossbow', 'orb'];
}
const TRAIN_KEYS = ['knife', 'long', 'hammer', 'crossbow', 'orb', 'ember'];
const TRAIN_MONS = ['moth', 'bomber', 'raider', 'grenadier', 'sniper'];
function trainingSelect(key) {
  if (!S.training || !WEAP[key]) return;
  const slot = WEAP[key].slot;
  P.weapon[slot] = key;
  P.slot = slot === 'melee' ? 0 : 1;
  P.atkPending = null;
  P.atkBuf = 0;
  P.drawWeapT = 0.18; P.sheatheT = 0;
  sfx('ui');
  toast('已装备 ' + WEAP[key].name + ' · ' + WEAP[key].dmg + ' 伤 · ' + (slot === 'melee' ? '点按挥击' : '长按连射'), PAL.gold);
  weaponHint(P.slot);
}
function trainingSpawn(kind) {
  if (!S.training || !MON_META[kind]) return null;
  const live = S.monsters.filter(m => m.kind !== 'dummy' && !m.dead);
  if (live.length >= 5) live[0].dead = true;
  const off = Math.round((rng() - 0.5) * 24);
  let m;
  if (kind === 'raider') {
    const rx = P.x < CFG.W / 2 ? CFG.W - 120 : 120;
    m = spawnMonster('raider', rx, -CFG.platT - 15, { x0: CFG.wallT + 10, x1: CFG.W - CFG.wallT - 10, dir: P.x < rx ? -1 : 1, t: 0 });
    m.cd = 0.25;
  } else if (kind === 'grenadier') {
    const gx = P.x < CFG.W / 2 ? CFG.W - 112 : 112;
    m = spawnMonster('grenadier', gx, -CFG.platT - 13, { x0: CFG.wallT + 12, x1: CFG.W - CFG.wallT - 12, dir: P.x < gx ? -1 : 1, t: 0 });
    m.cd = 0.28;
  } else if (kind === 'bomber') {
    m = spawnMonster('bomber', (P.x > CFG.W / 2 ? CFG.W * 0.24 : CFG.W * 0.76) + off, -96, { t: 0 });
    m.cd = 0.22;
  } else if (kind === 'sniper') {
    m = spawnMonster('sniper', (P.x > CFG.W / 2 ? CFG.W * 0.23 : CFG.W * 0.77) + Math.round(off * 0.5), -108, { t: 0 });
    m.cd = 0.18;
  } else {
    m = spawnMonster('moth', (P.x > CFG.W / 2 ? CFG.W * 0.26 : CFG.W * 0.74) + off, -88, { t: 0 });
    m.cd = 0.25;
  }
  burst(m.x, m.y, 10, PAL.violet);
  sfx('ui');
  toast('已召唤 ' + MON_META[kind].name + '（' + MON_META[kind].tag + '）', PAL.violet);
  return m;
}
function resetDummy() {
  if (!S.training || !S.dummy) return;
  S.dummy.hp = S.dummy.max; S.dummy.flash = 0; S.dummy.hitT = 0;
  S.monsters = [S.dummy];
  S.boss = null; S.arena = null; S.arenaHazards = []; S.bossRewardOpen = false; S.bossRewards = [];
  S.eshots = []; S.eblasts = [];
  for (const tp of S.traps) if (tp.kind === 'rock') { tp.state = 'idle'; tp.y = tp.y0; tp.vy = 0; } S.drops = []; S.orbs = [];
  P.hp = CFG.hpMax; P.iframe = 0;
  if (S.trainTrap) trainingTrap(S.trainTrap, true);
  const t0 = S.trainingStats ? S.trainingStats.time : 0;
  S.trainingStats = { dmg: 0, hits: 0, time: t0, last: 0, marks: [] };
  burst(S.dummy.x, S.dummy.y, 14, PAL.gold);
  toast('木偶已重置 · 场地与血量恢复', PAL.gold);
  sfx('level');
}
/* 训练场召唤四大镇楼 Boss 实测封锁与限时讨伐 */
function trainingBoss(forceKind) {
  if (!S.training) return null;
  S.monsters = S.monsters.filter(m => m.kind !== 'boss');
  S.arenaHazards = []; S.eshots = []; S.eblasts = [];
  const bk = (forceKind && BOSS_META[forceKind]) ? forceKind : TRAIN_BOSS_ORDER[S.trainBossIdx % TRAIN_BOSS_ORDER.length];
  S.trainBossIdx++;
  const b = spawnBoss(bk, Math.round(CFG.W * 0.70), -CFG.platT, 15, false);
  const meta = BOSS_META[bk];
  S.boss = b;
  S.arena = {
    floor: 0, bkind: bk, boss: b, active: true,
    topY: -208, botY: -CFG.platT,
    timeLeft: meta.time, timeMax: meta.time, tickSec: 8,
  };
  P.hp = CFG.hpMax;
  if (P.x > CFG.W * 0.52) P.x = Math.round(CFG.W * 0.22);
  burst(b.x, b.y, 20, meta.c);
  S.shake = 5; S.shakeT = 0.16; sfx('bossseal');
  toast('试炼封锁：' + meta.title + '（限时 ' + meta.time + 's · B 切换）', meta.c);
  return b;
}
/* 训练场陷阱展示：同一时间只摆一种，摆在出生点与木偶之间 */
function trainingTrap(kind, quiet) {
  if (!S.training || !TRAP_META[kind]) return;
  const f0 = S.floors.get(0); if (!f0) return;
  S.traps = [];
  S.monsters = S.monsters.filter(m => m.kind !== 'turret');
  S.eshots = S.eshots.filter(e => e.kind !== 'arrow');
  f0.spikeWall = false;
  for (const p of f0.plats) if (p.type === 'belt' || p.type === 'ice') { p.type = 'norm'; p.beltDir = 0; }
  const ground = f0.plats[0];
  S.trainTrap = kind;
  if (kind === 'saw') placeTrap(kind, f0, ground, CFG.W / 2, { x0: CFG.W / 2 - 80, x1: CFG.W / 2 + 80 });
  else if (kind === 'turret') placeTrap(kind, f0, ground, 0, { face: -1 });
  else if (kind === 'belt') placeTrap(kind, f0, ground, 0, { dir: 1 });
  else placeTrap(kind, f0, ground, CFG.W / 2);
  for (const tp of S.traps) { tp.off = 0; tp.t = 0; }
  if (!quiet) {
    const tm = TRAP_META[kind];
    toast('陷阱展示：' + tm.name + '（' + tm.tag + (tm.dmg ? ' · ' + tm.dmg + ' 伤害' : '') + '）· F 切换', PAL.gold);
    sfx('ui');
  }
}
/* 陷阱摆放（genFloor 与训练场共用）：mx 为落脚台上的中心 x */
function placeTrap(kind, fl, land, mx, opts) {
  opts = opts || {};
  const top = land.y - CFG.platT;
  const fi = fl.i;
  if (kind === 'spike') {
    S.traps.push({ kind, x0: mx - 16, x1: mx + 16, y: top, floor: fi, t: 0, off: rng() * 2.3, phase: 'off' });
  } else if (kind === 'flame') {
    S.traps.push({ kind, x: mx, y: top, floor: fi, t: 0, off: rng() * 2.75, phase: 'off' });
  } else if (kind === 'saw') {
    const x0 = opts.x0 !== undefined ? opts.x0 : land.x + 14, x1 = opts.x1 !== undefined ? opts.x1 : land.x + land.w - 14;
    S.traps.push({ kind, x: Math.max(x0, Math.min(x1, mx)), y: top, x0, x1, dir: rng() < 0.5 ? 1 : -1, floor: fi, t: 0, spin: 0 });
  } else if (kind === 'rock') {
    S.traps.push({ kind, x: mx, y0: top - 74, y: top - 74, ground: top, floor: fi, t: 0, state: 'idle', st: 0, vy: 0 });
  } else if (kind === 'belt') {
    land.type = 'belt'; land.beltDir = opts.dir || (rng() < 0.5 ? 1 : -1);
  } else if (kind === 'ice') {
    land.type = 'ice';
  } else if (kind === 'spikewall') {
    fl.spikeWall = true;
  } else if (kind === 'turret') {
    const face = opts.face || (land.x <= CFG.wallT + 1 ? 1 : -1);
    const tx = face > 0 ? CFG.wallT + 7 : CFG.W - CFG.wallT - 7;
    const m = spawnMonster('turret', tx, top - 15, { dir: face, cd: 1.0 + rng() * 0.6 });
    m.trapFloor = fi;
  }
}
function trapHitPlayer(x0, y0, x1, y1) {
  return !P.dead && P.x + P.w / 2 - 2 > x0 && P.x - P.w / 2 + 2 < x1 && P.y + P.h / 2 > y0 && P.y - P.h / 2 < y1;
}
/* 伤怪型陷阱：同一只怪 0.8s 内只吃一次，避免一帧打穿 */
function trapHitMonsters(x0, y0, x1, y1, dmg) {
  for (const m of S.monsters) {
    if (m.dead || m.kind === 'dummy' || m.kind === 'boss' || m.kind === 'turret' || m.trapCd > 0) continue;
    const hb = mHalf(m);
    if (m.x + hb.x > x0 && m.x - hb.x < x1 && m.y + hb.y > y0 && m.y - hb.y < y1) {
      m.trapCd = 0.8;
      hurt(m, dmg, Math.sign(m.x - (x0 + x1) / 2) || 1, true, true, 'push');
    }
  }
}
function trapNear(y) { return Math.abs(y - P.y) < 220; }
function updateTraps(dt) {
  for (const tp of S.traps) {
    tp.t += dt;
    if (tp.kind === 'spike' || tp.kind === 'flame') {
      const c = tp.kind === 'spike' ? [1.1, 0.45, 0.75] : [1.4, 0.5, 0.85];
      const per = c[0] + c[1] + c[2];
      const ph = (tp.t + (tp.off || 0)) % per;
      const prev = tp.phase;
      tp.phase = ph < c[0] ? 'off' : ph < c[0] + c[1] ? 'warn' : 'on';
      tp.u = tp.phase === 'on' ? (ph - c[0] - c[1]) / c[2] : tp.phase === 'warn' ? (ph - c[0]) / c[1] : 0;
      if (tp.phase !== prev && trapNear(tp.y)) {
        if (tp.phase === 'warn') sfx('trapwarn');
        else if (tp.phase === 'on') sfx(tp.kind === 'spike' ? 'spike' : 'flame');
      }
      if (tp.phase !== 'on') continue;
      const dmg = TRAP_META[tp.kind].dmg;
      if (tp.kind === 'spike') {
        if (trapHitPlayer(tp.x0, tp.y - 12, tp.x1, tp.y + 2)) damagePlayer(dmg, (Math.sign(P.x - (tp.x0 + tp.x1) / 2) || -P.face) * 150, -320, 'trap', TRAP_META.spike.name);
        trapHitMonsters(tp.x0, tp.y - 12, tp.x1, tp.y + 2, dmg);
      } else {
        if (trapHitPlayer(tp.x - 9, tp.y - 54, tp.x + 9, tp.y)) damagePlayer(dmg, (Math.sign(P.x - tp.x) || -P.face) * 170, -250, 'trap', TRAP_META.flame.name);
        trapHitMonsters(tp.x - 9, tp.y - 54, tp.x + 9, tp.y, dmg);
        if (S.frames % 3 === 0) S.parts.push({ x: tp.x + (rng() - 0.5) * 10, y: tp.y - 50 - rng() * 8, vx: (rng() - 0.5) * 30, vy: -40 - rng() * 40, t: 0.3, c: rng() < 0.5 ? PAL.gold : PAL.red, s: 2 });
      }
    } else if (tp.kind === 'saw') {
      tp.x += tp.dir * 64 * dt; tp.spin += dt * 18;
      if (tp.x <= tp.x0) { tp.x = tp.x0; tp.dir = 1; }
      if (tp.x >= tp.x1) { tp.x = tp.x1; tp.dir = -1; }
      if (S.frames % 4 === 0) S.parts.push({ x: tp.x - tp.dir * 8, y: tp.y - 1, vx: -tp.dir * (40 + rng() * 40), vy: -30 - rng() * 40, t: 0.2, c: PAL.gold, s: 1 });
      if (trapNear(tp.y) && Math.abs(tp.x - P.x) < 70 && S.frames % 12 === 0) sfx('saw');
      const dmg = TRAP_META.saw.dmg;
      if (trapHitPlayer(tp.x - 10, tp.y - 11, tp.x + 10, tp.y + 2)) damagePlayer(dmg, (Math.sign(P.x - tp.x) || tp.dir) * 200, -270, 'trap', TRAP_META.saw.name);
      trapHitMonsters(tp.x - 10, tp.y - 11, tp.x + 10, tp.y + 2, dmg);
    } else if (tp.kind === 'rock') {
      if (tp.state === 'idle') {
        tp.y = tp.y0;
        if (!P.dead && Math.abs(P.x - tp.x) < 26 && P.y > tp.y0 && P.y - tp.y0 < 130) { tp.state = 'warn'; tp.st = 0.5; if (trapNear(tp.y)) sfx('trapwarn'); }
      } else if (tp.state === 'warn') {
        tp.st -= dt;
        if (S.frames % 4 === 0) S.parts.push({ x: tp.x + (rng() - 0.5) * 14, y: tp.y0 - 8, vx: (rng() - 0.5) * 16, vy: 20, t: 0.3, c: PAL.stone2, s: 2 });
        if (tp.st <= 0) { tp.state = 'fall'; tp.vy = 0; }
      } else if (tp.state === 'fall') {
        tp.vy += 1500 * dt; tp.y += tp.vy * dt;
        const dmg = TRAP_META.rock.dmg;
        let shatter = tp.y + 7 >= tp.ground;
        if (trapHitPlayer(tp.x - 9, tp.y - 8, tp.x + 9, tp.y + 8)) {
          if (damagePlayer(dmg, (Math.sign(P.x - tp.x) || -P.face) * 120, -160, 'trap', TRAP_META.rock.name)) shatter = true;
        }
        trapHitMonsters(tp.x - 10, tp.y - 8, tp.x + 10, tp.y + 10, dmg);
        if (shatter) {
          trapHitMonsters(tp.x - 14, tp.ground - 22, tp.x + 14, tp.ground + 2, dmg);
          tp.state = 'gone'; tp.st = 3.2; tp.y = Math.min(tp.y, tp.ground - 7);
          burst(tp.x, tp.y + 4, 12, PAL.stone2);
          if (trapNear(tp.y)) { sfx('rock'); S.shake = Math.max(S.shake, 3); S.shakeT = 0.1; }
        }
      } else {
        tp.st -= dt;
        if (tp.st <= 0) { tp.state = 'idle'; tp.y = tp.y0; }
      }
    }
  }
}
/* ---------- 战祭坛：可选高收益战斗（普通层照常赶路，每 6 层一座可绕开的祭坛） ---------- */
function pactNear() {
  return !!(S.pact && S.pact.state === 'idle' && Math.abs(P.x - S.pact.x) < 52 && Math.abs(P.y - S.pact.y) < 72);
}
function activatePact() {
  if (!S.pact || S.pact.state !== 'idle' || P.dead || S.training || S.paused || S.shopOpen || S.panel || S.helpOpen) return false;
  if (Math.abs(P.x - S.pact.x) > 60 || Math.abs(P.y - S.pact.y) > 80) { toast('走近战祭坛再开战', PAL.mut); return false; }
  S.pact.state = 'fight'; S.pact.t = 0;
  S.flash = 0.10; S.shake = 4; S.shakeT = 0.16; sfx('bossseal');
  const fl = S.pact.floor;
  const pool = ['crawl', 'raider', 'moth'];
  if (fl >= 12) pool.push('grenadier');
  if (fl >= 18) pool.push('sniper');
  const spots = [S.pact.x - 46, S.pact.x, S.pact.x + 46];
  const dyFor = { crawl: 8, raider: 15, grenadier: 13, moth: 10, sniper: 24 };
  for (let k = 0; k < 3; k++) {
    const kind = pool[(k + Math.floor(fl / 6)) % pool.length];
    const x = Math.max(CFG.wallT + 18, Math.min(CFG.W - CFG.wallT - 18, Math.round(spots[k])));
    const yy = S.pact.y - (dyFor[kind] || 10);
    let m;
    if (kind === 'raider' || kind === 'grenadier') m = spawnMonster(kind, x, yy, { x0: x - 36, x1: x + 36, dir: k % 2 ? 1 : -1, t: 0 });
    else m = spawnMonster(kind, x, yy, { t: 0 });
    if (m) { m.pactMob = true; m.cd = 0.35 + k * 0.1; }
  }
  S.pact.left = S.monsters.filter(m => m.pactMob && !m.dead).length;
  toast('战祭开启：清掉 ' + S.pact.left + ' 只魔物 · 崩落暂停 · 逃上两层即放弃', PAL.red);
  return true;
}
function markPactDone() {
  if (!S.pact) return;
  const fl = S.floors.get(S.pact.floor);
  if (fl) { const land = fl.plats.find(p => p.pact); if (land) land.pactDone = true; }
}
function failPact(msg) {
  if (!S.pact || S.pact.state !== 'fight') return;
  for (const m of S.monsters) if (m.pactMob && !m.dead) m.dead = true;
  markPactDone();
  S.pact.state = 'done'; S.pact.failed = true;
  toast(msg || '战祭放弃 · 魔物散去，未得赏赐', PAL.mut);
}
function pactComplete() {
  if (!S.pact || S.pact.state !== 'fight') return;
  markPactDone();
  S.pact.state = 'done'; S.pact.failed = false;
  /* 奖励立即改变打法：优先给未拥有的符文；符文全有则战意 +40% 攻击 60s（不是只给金币） */
  const pool = ['thunder', 'feather', 'ice'].filter(r => !P.runes.includes(r));
  let rewardTxt;
  if (pool.length) {
    const id = pool[Math.floor(rng() * pool.length)];
    addRune(id);
    rewardTxt = '符文「' + RUNE_NAME[id] + '」';
  } else {
    P.furyT = 60;
    rewardTxt = '战意沸腾 · 攻击 +40% 持续 60s';
  }
  P.hp = Math.min(CFG.hpMax, P.hp + 30);
  S.coins += 25; S.score += 60;
  S.collapseHoldT = Math.max(S.collapseHoldT || 0, 2); // 结算后 2s 喘息，避免领奖即被崩落吞掉
  S.flash = 0.10; S.shake = 4; S.shakeT = 0.16; sfx('boon');
  toast('战祭完成 · ' + rewardTxt + ' · 回复 30 生命 + 25 金', PAL.gold);
}
function ensurePactNear() {
  if (S.pact || S.training) return;
  const pf = Math.max(0, Math.floor(-P.y / CFG.FH));
  for (let f = pf; f <= pf + 2; f++) {
    const fl = S.floors.get(f);
    if (!fl) continue;
    const land = fl.plats.find(p => p.pact);
    if (land) { S.pact = { floor: f, x: land.x + land.w / 2, y: land.y - CFG.platT, state: 'idle', left: 0, t: 0 }; return; }
  }
}
function pactTick(dt) {
  if (!S.pact) return;
  const pf = Math.max(0, Math.floor(-P.y / CFG.FH));
  if (S.pact.state === 'idle') {
    /* 直接绕开：不弹任何惩罚，静默取消追踪 */
    if (pf >= S.pact.floor + 2) S.pact = null;
    return;
  }
  if (S.pact.state === 'done') {
    /* 结算完离开两层后释放，后续祭坛仍可出现 */
    if (pf >= S.pact.floor + 2) S.pact = null;
    return;
  }
  if (S.pact.state === 'fight') {
    S.pact.t += dt;
    S.pact.left = S.monsters.filter(m => m.pactMob && !m.dead).length;
    if (S.pact.left <= 0) { pactComplete(); return; }
    if (pf >= S.pact.floor + 2) failPact('战祭放弃 · 逃上两层，魔物散去');
  }
}
function leaveTraining() {
  if (!S.training) return;
  S.training = false;
  S.dummy = null; S.trainingStats = null; S.traps = []; S.trainTrap = null;
  S.screen = 'menu'; S.menuPage = 'home';
  S.monsters = []; S.shots = []; S.eshots = []; S.eblasts = []; S.trails = []; S.drops = []; S.orbs = []; S.parts = [];
  S.boss = null; S.arena = null; S.arenaHazards = []; S.bossRewardOpen = false; S.bossRewards = [];
  S.toasts = []; S.panel = false; S.shopOpen = false; S.banner = null;
  ptr.clear(); syncHoldInputs(); setPaused(false, true);
  S.hitstop = 0; S.shake = 0; S.shakeT = 0; S.flash = 0; S.deathT = -1;
  sfx('ui');
}
function endRun(reason) {
  if (S.screen !== 'playing') return;
  /* 结算口径统一：主数字＝本局最高到达（bestThisRun），死亡所在层单独记录。
     历史最佳 / 印记 / 当日档案全部按最高到达计；复活不清空 bestThisRun，层奖励只在首次到达发放。 */
  const deathFloor = Math.max(0, Math.floor(-P.y / CFG.FH));
  const best = Math.max(deathFloor, S.bestThisRun);
  S.finalBest = best; S.finalDeathFloor = deathFloor;
  S.finalNewRecord = best > S.meta.best;
  const marks = best * 2 + S.kills + S.bossKills * 15 + (S.heartMarks || 0) + (S.deaths === 0 ? 20 : 0);
  S.runMarks = marks; S.meta.marks += marks;
  /* 成就统计（印记解锁的前置条件）：单局击杀、单局符文、累计击杀 */
  S.meta.killBest = Math.max(S.meta.killBest || 0, S.kills || 0);
  S.meta.runeBest = Math.max(S.meta.runeBest || 0, (P.runes || []).length);
  S.meta.totalKills = (S.meta.totalKills || 0) + (S.kills || 0);
  if (S.finalNewRecord) S.meta.best = best;
  const bk = { endless: 'bestEndless', limited: 'bestLimited', daily: 'bestDaily' }[S.mode];
  if (bk && best > S.meta[bk]) S.meta[bk] = best;
  if (S.mode === 'daily') {
    const k = dailyKey();
    if (!S.meta.dailyRec || typeof S.meta.dailyRec !== 'object') S.meta.dailyRec = {};
    if (best > (S.meta.dailyRec[k] || 0)) S.meta.dailyRec[k] = best;
    S.meta.bestDaily = S.meta.dailyRec[k]; // 当日最佳（跨日自然归零，因为新日期键无记录）
  }
  saveMeta();
  S.deathReason = reason || S.lastDeath || 'collapse';
  if (reason === 'time') sfx('timeup');
  S.screen = 'dead'; S.shopOpen = false; S.bossRewardOpen = false; S.arena = null; S.arenaHazards = []; setPaused(false, true);
}
/* ---------- 区域规则（本地池；任务 3 换成 AI 生成，接口不变） ---------- */
function openGate(g) {
  S.shopOpen = true;
  clearGameplayInput();
  const r = RULES[Math.floor(rng() * RULES.length)];
  S.rule = r;
  S.zone = { from: g + 1, to: g + 9 };
  S.banner = { t: 3.4, floor: g, text: r.text, mech: r.mech };
  S.ruleMul = r.id === 'fast' ? 1.3 : 1;
  S.dark = r.id === 'dark';
  S.richZone = r.id === 'rich';
  applyZone(g + 1, g + 9, r);
  if (r.id === 'rich') S.chests.push({ x: CFG.W / 2, y: floorY(g + 5) - CFG.platT - 10, floor: g + 5, opened: false, t: 0 });
  toast('守门吏：' + r.text + ' · ' + r.mech, PAL.violet); sfx('gate');
}
function applyZone(from, to, r) {
  ensureFloors(to + 2);
  for (let i = from; i <= to; i++) {
    const f = S.floors.get(i); if (!f) continue;
    for (const p of f.plats) {
      if (r.id === 'noBlue' && !p.landing && rng() < 0.55) { p.blue = true; p.blueHit = false; }
      if (r.id === 'fragile' && !p.landing) { p.type = 'brit'; p.steps = 2; }
    }
  }
}
function shopOffers() {
  const healAmt = Math.max(0, Math.min(30, CFG.hpMax - P.hp));
  const slotCap = 3, slots = CFG.runeSlots || 2;
  return [
    { name: '回血 ' + healAmt, cost: 20, ok: P.hp < CFG.hpMax, reason: '生命已满',
      desc: healAmt > 0 ? '恢复 ' + healAmt + ' 点生命值（' + P.hp + '/' + CFG.hpMax + '）' : '生命值已满，无需恢复',
      apply: () => { const a = Math.min(30, CFG.hpMax - P.hp); P.hp += a; return a; }, repeatable: true },
    { name: '攻击 +10%', cost: 30, ok: true, reason: '',
      desc: '本局攻击伤害 +10%（可叠加）',
      apply: () => { P.atkMul = +(P.atkMul + 0.1).toFixed(2); }, repeatable: true },
    { name: '符文槽 +1', cost: 40, ok: slots < slotCap, reason: '槽位已满',
      desc: slots < slotCap ? '秘符槽位上限 +1（当前 ' + slots + '/' + slotCap + '）' : '秘符槽位已达上限 ' + slotCap,
      apply: () => { CFG.runeSlots = Math.min(slotCap, (CFG.runeSlots || 2) + 1); }, repeatable: false },
    /* 黑市孤品：只能用金币在此购得，印记祭坛与宝箱都不会给 */
    { name: '烬铁巨剑', cost: 120, ok: !S.meta.ember, reason: '已在黑市购得',
      desc: S.meta.ember ? '巨剑已铸入兵器库，出征时可选' : '黑市孤品 · 34 伤 / 120° 宽扫震地 · 永久解锁，仅此处可得',
      permanent: true,
      apply: () => { S.meta.ember = true; saveMeta(); return 0; } },
  ];
}
function buyOffer(i) {
  const o = shopOffers()[i]; if (!o) return;
  /* 先校验有效性，再校验金币，最后才扣费——无效购买绝不扣钱 */
  if (!o.ok) { toast(o.reason || '当前无法购买', PAL.mut); sfx('deny'); return; }
  if (S.coins < o.cost) { toast('金币不够（' + S.coins + '/' + o.cost + '）', PAL.red); sfx('deny'); return; }
  S.coins -= o.cost;
  const healed = o.apply();
  if (o.permanent) toast('已解锁：' + o.name + ' · 回门厅后可在出征时携带', PAL.gold);
  else if (i === 0) toast('已购买：回血 +' + healed + '（' + P.hp + '/' + CFG.hpMax + '）', PAL.gold);
  else toast('已购买：' + o.name, PAL.gold);
  sfx('buy');
}
function buyMeta(key, cost, label) {
  if (S.meta[key]) { toast('已解锁', PAL.mut); sfx('deny'); return; }
  const a = ACH[key];
  if (a && !achDone(key)) {
    const info = achInfo(key);
    toast('尚需成就「' + a.name + '」· ' + a.unit + ' ' + info.val + '/' + a.goal + (a.unit2 || ''), PAL.red);
    sfx('deny'); return;
  }
  if (S.meta.marks < cost) { toast('印记不够（' + S.meta.marks + '/' + cost + '）', PAL.red); sfx('deny'); return; }
  S.meta.marks -= cost; S.meta[key] = true; saveMeta();
  toast('已解锁：' + label + '（下一局生效）', PAL.gold); sfx('buy');
}
const P = {
  x: 60, y: 0, vx: 0, vy: 0, w: 16, h: 30, onGround: false, coyote: 0, buf: 0, jumps: 0,
  face: 1, wall: 0, grabT: 0, climbing: false, slamming: false, atkCd: 0, atkBuf: 0, atkCount: 0, slot: 0, furyT: 0,
  hp: CFG.hpMax, iframe: 0, cut: false, dead: false, atkMul: 1, spdMul: 1, lv: 1,
  dodgeT: 0, dodgeCd: 0, dodgeDir: 1, airDodge: false,
  sx: 1, sy: 1, landT: 0, skidT: 0, hurtT: 0, slamT: 0, slamLandT: 0, sheatheT: 0, sheatheW: 'knife', drawWeapT: 0,
  anim: { st: 'idle', t: 0, f: 0, runPhase: 0, atk: 0, atkDur: 0, atkW: 'knife' },
  owned: { melee: ['knife', 'long'], ranged: ['crossbow'] }, weapon: { melee: 'knife', ranged: 'crossbow' },
  runes: [], airBonus: 0, lastFloor: 0,
};
const S_FLOAT = [];
/* 动作帧表：frames 帧数，frame 每帧秒数（攻击按武器由 doAttack 设定时长） */
const ANIM = {
  idle: { frames: 2, frame: 0.55 },
  run: { frames: 8, frame: 0.05 },
  walk: { frames: 8, frame: 0.08 },
  jump: { frames: 3, frame: 0.09 },
  fall: { frames: 2, frame: 0.1 },
  slam: { frames: 3, frame: 0.07 },
  hurt: { frames: 2, frame: 0.07 },
  dodge: { frames: 3, frame: 0.06 },
  climb: { frames: 4, frame: 0.11 },
  wallslide: { frames: 2, frame: 0.12 },
  dead: { frames: 4, frame: 0.12 },
};

function floorY(i) { return -i * CFG.FH; }
function ensureFloors(upTo) {
  const start = S.floorStart || 0;
  for (let i = start; i <= upTo; i++) if (!S.floors.has(i)) genFloor(i);
  /* 历史崩塌楼层滑动窗口垃圾回收：安全卸载检查点与崩落线 6 层以下废弃跳台，杜绝内存膨胀 */
  if (S.screen === 'playing' && !S.training && S.collapseOn && upTo > 18) {
    const collapseFloor = Math.max(0, Math.floor(-S.collapseY / CFG.FH));
    const cpFloor = (S.checkpoint && S.checkpoint.floor !== undefined) ? S.checkpoint.floor : 0;
    const minSafe = Math.max(0, Math.min(collapseFloor - 6, cpFloor - 2));
    if (minSafe > start) {
      for (const f of Array.from(S.floors.keys())) {
        if (f < minSafe) S.floors.delete(f);
      }
      S.floorStart = minSafe;
    }
  }
}

function spawnMonster(kind, x, y, opts) {
  opts = opts || {};
  const meta = MON_META[kind] || { hp: 20, dmg: 15 };
  const diff = S.training ? DIFFICULTY.normal : difficultyNow();
  const hp = opts.hp !== undefined ? opts.hp : Math.max(1, Math.round(meta.hp * diff.hp));
  const m = {
    kind, x, y,
    x0: opts.x0 !== undefined ? opts.x0 : x,
    y0: opts.y0 !== undefined ? opts.y0 : y,
    x1: opts.x1 !== undefined ? opts.x1 : x,
    dir: opts.dir || 1,
    hp, max: hp,
    dmg: opts.dmg !== undefined ? opts.dmg : Math.max(1, Math.round(meta.dmg * diff.dmg)),
    t: opts.t !== undefined ? opts.t : rng() * 6,
    flash: 0, dead: false,
    state: kind === 'raider' ? 'patrol' : 'idle',
    cd: opts.cd !== undefined ? opts.cd : (0.7 + rng() * 0.9),
    charge: 0, stateT: 0, calm: 0, aimAng: 0, vx: 0, vy: 0,
  };
  S.monsters.push(m);
  return m;
}

function bossKindForFloor(i) {
  if (i <= 0) return 'colossus';
  const bossIdx = Math.max(0, Math.round(i / CFG.bossEvery) - 1);
  const stage = bossIdx % 5;
  if (stage === 4) return 'heart';
  return BOSS_ORDER[stage];
}
function spawnBoss(bkind, x, groundY, floor, dormant) {
  const meta = BOSS_META[bkind] || BOSS_META.colossus;
  const bossIdx = Math.max(0, Math.round((floor || CFG.bossEvery) / CFG.bossEvery) - 1);
  const cycle = Math.floor(bossIdx / 5);
  const diff = S.training ? DIFFICULTY.normal : difficultyNow();
  const hp = Math.max(1, Math.round(meta.hp * (1 + cycle * 0.35) * diff.hp));
  const dmg = Math.max(1, Math.round(meta.dmg * (1 + cycle * 0.15) * diff.dmg));
  const yInit = bkind === 'heart' ? groundY - 100 : bkind === 'colossus' ? groundY - 26 : bkind === 'shura' ? groundY - 24 : bkind === 'lantern' ? groundY - 72 : groundY - 94;
  const b = {
    kind: 'boss', bkind, x, y: yInit, x0: x, y0: yInit, groundY, floor,
    hp, max: hp, dmg, phase: 1, dir: -1, t: 0, flash: 0, dead: false,
    dormant: !!dormant, escaped: false,
    bstate: 'idle', btimer: 0.85, skillIdx: 0, subStep: 0,
    vx: 0, vy: 0, aimAng: Math.PI * 0.72, laserStart: 0, laserEnd: 0,
  };
  S.monsters.push(b);
  return b;
}

/* 之字形楼梯文法：普通层 = 落脚台 + 三级 24px 台阶斜升；
   50F 倍数 Boss 决斗大殿横跨 fl 与 fl+1 双层挑高，构建「满宽祭坛 + 左右双翼(+46) + 中央大高台(+96) + 左上/右上破阵高台(+142)」五台对称战术矩阵 */
function genFloorLegacy(i) {
  const y = floorY(i);
  const plats = [];
  const bossFl = isBossFloor(i);
  const arenaUpper = isBossArenaUpper(i);
  const full = (i === 0 || i % 10 === 0 || bossFl);
  const dir = i % 2 === 0 ? 1 : -1;
  let lx = 0, lw = CFG.W;
  if (bossFl) {
    plats.push({ x: 0, w: CFG.W, y, type: 'boss', landing: true });
    plats.push({ x: 32, w: 80, y: y - 46, type: 'norm', landing: false, arenaWing: (i % 2 === 1) });
    plats.push({ x: 248, w: 80, y: y - 46, type: 'norm', landing: false, arenaWing: (i % 2 === 0) });
  } else if (arenaUpper) {
    const nextLeft = ((i + 1) % 2 === 0);
    plats.push({ x: 122, w: 116, y, type: 'norm', landing: true });
    plats.push({ x: 38, w: 76, y: y - 46, type: 'norm', landing: false, arenaWing: !nextLeft });
    plats.push({ x: 246, w: 76, y: y - 46, type: 'norm', landing: false, arenaWing: nextLeft });
  } else {
    if (full) {
      plats.push({ x: 0, w: CFG.W, type: (i > 0 && i % 10 === 0 ? 'gate' : 'norm'), landing: true });
    } else {
      lw = 120 + Math.floor(rng() * 40);
      lx = dir === 1 ? CFG.wallT : CFG.W - CFG.wallT - lw;
      plats.push({ x: lx, w: lw, type: 'norm', landing: true });
    }
    const startX = full
      ? (dir === 1 ? CFG.wallT + 20 : CFG.W - CFG.wallT - 20 - CFG.stepW)
      : (dir === 1 ? lx + lw - CFG.stepW : lx);
    for (let k = 1; k <= 3; k++) {
      if (k === 2 && rng() < 0.18) continue;     // 缺口：必须跳
      const t = rng();
      plats.push({
        x: Math.max(CFG.wallT, Math.min(CFG.W - CFG.wallT - CFG.stepW, startX + dir * 56 * k)),
        w: CFG.stepW, y: y - k * CFG.stepH,
        type: (t < 0.80 ? 'norm' : (t < 0.91 ? 'brit' : 'bounce')), landing: false,
      });
    }
  }
  for (const p of plats) { if (p.y === undefined) p.y = y; p.floor = i; p.steps = 2; p.warn = false; p.gone = false; }
  /* 战祭坛层：每 6 层一座（避开 10 层门楼与 Boss 层），可选绕开 */
  if (i > 0 && i % 6 === 0 && i % 10 !== 0 && !bossFl && !arenaUpper) plats[0].pact = true;
  const wall = (i > 0 && (i % 10 !== 0 || bossFl || arenaUpper)) ? (i % 2 === 0 ? 'R' : 'L') : null;
  S.floors.set(i, { i, y, plats, wall, bossFloor: bossFl, arenaUpper });
  /* 陷阱 3~17 层渐进首秀（避开双层 Boss 决斗大殿），单层至多 1 个；落脚台被占时地面怪概率减半 */
  let landBusy = false;
  if (i >= 3 && i % 10 !== 0 && !bossFl && !arenaUpper) {
    let tk = TRAP_DEBUT[i] || null;
    if (!tk && rng() < Math.min(0.30 + i * 0.012, 0.62)) {
      const pool = TRAP_KINDS.filter(k => i >= TRAP_UNLOCK[k] && (k !== 'spikewall' || wall));
      tk = pool[Math.floor(rng() * pool.length)];
    }
    if (tk) {
      const land = plats[0];
      placeTrap(tk, S.floors.get(i), land, land.x + land.w / 2);
      landBusy = tk !== 'turret' && tk !== 'spikewall';
    }
  }
  /* 怪物 2~12 层快速渐进解锁（双层 Boss 决斗大殿不刷普通杂兵，保持空间纯净） */
  const spawnStart = S.monsters.length;
  if (i >= 1 && i % 10 !== 0 && !bossFl && !arenaUpper) {
    const land = plats[0];
    const gProb = (i <= 2 ? 0.32 : Math.min(0.38 + i * 0.008, 0.75)) * (landBusy ? 0.5 : 1);
    if (i === 6 || i === 8 || rng() < gProb) {
      let gk = 'crawl';
      if (i === 6 && land.w >= 96) gk = 'raider';
      else if (i === 8) gk = 'grenadier';
      else {
        const gPool = ['crawl'];
        if (i >= 6 && land.w >= 96) gPool.push('raider');
        if (i >= 8) gPool.push('grenadier');
        gk = gPool[Math.floor(rng() * gPool.length)];
      }
      if (gk === 'raider') {
        spawnMonster('raider', land.x + land.w * 0.5, land.y - CFG.platT - 15, { x0: land.x + 14, x1: land.x + land.w - 14, dir: rng() < 0.5 ? 1 : -1 });
      } else if (gk === 'grenadier') {
        spawnMonster('grenadier', land.x + land.w * 0.55, land.y - CFG.platT - 13, { x0: land.x + 12, x1: land.x + land.w - 12, dir: dir < 0 ? 1 : -1 });
      } else {
        spawnMonster('crawl', land.x + 16, land.y - CFG.platT - 8, { x0: land.x + 10, x1: land.x + land.w - 12, dir: 1 });
      }
    }
    const st = plats[1 + Math.floor(rng() * Math.max(1, plats.length - 1))];
    const aProb = i === 1 ? 0.28 : Math.min(0.34 + i * 0.008, 0.72);
    if (st && (i === 2 || i === 4 || i === 11 || rng() < aProb)) {
      let ak = 'wisp';
      if (i === 2) ak = 'moth';
      else if (i === 4) ak = 'bomber';
      else if (i === 11) ak = 'sniper';
      else {
        const aPool = ['wisp'];
        if (i >= 2) aPool.push('moth');
        if (i >= 4) aPool.push('bomber');
        if (i >= 11) aPool.push('sniper');
        ak = aPool[Math.floor(rng() * aPool.length)];
      }
      const ax = Math.max(CFG.wallT + 20, Math.min(CFG.W - CFG.wallT - 20, st.x + st.w / 2));
      const rawAy = st.y - (ak === 'sniper' ? 44 : 36);
      const ceilLim = ((i + 1) % 10 === 0 || isBossFloor(i + 1)) ? floorY(i + 1) + 24 : -Infinity;
      const ay = Math.max(ceilLim, rawAy);
      spawnMonster(ak, ax, ay, { x0: ax, y0: ay });
    }
  }
  if (i >= 10 && S.monsters.length > spawnStart && rng() < 0.08) {
    const m = S.monsters[spawnStart + Math.floor(rng() * (S.monsters.length - spawnStart))];
    m.elite = true; m.hp = m.max = Math.round(m.hp * 1.6); m.dmg = Math.round(m.dmg * 1.2);
  }
  /* 宝箱：每 8 层 1 个，藏在上层台阶（避开双层 Boss 决斗大殿） */
  if (i > 0 && i % 8 === 0 && !bossFl && !arenaUpper) {
    const cand = plats.filter(p => !p.landing);
    const p0 = cand.length ? cand[Math.floor(rng() * cand.length)] : plats[0];
    S.chests.push({ x: p0.x + p0.w / 2, y: p0.y - CFG.platT - 10, floor: i, opened: false, t: 0 });
  }
  /* 首枚攀爬符固定 12 层 */
  if (i === 12) {
    const land = plats.find(p => p.landing);
    S.pickups.push({ id: 'climb', x: land.x + Math.max(20, land.w - 26), y: land.y - CFG.platT - 10, t: 0 });
  }
  /* 守门吏：每 10 层，读规则 NPC */
  if (i > 0 && i % 10 === 0) S.npcs.push({ x: CFG.W - 64, y: y - CFG.platT, floor: i, t: 0 });
  /* 镇楼 BOSS：每 50 层（50F 玄岳 / 100F 修罗 / 150F 幽烛 / 200F 天枢 / 250F 楼心），初始休眠镇守，踏入该层后上下封锁激活限时讨伐 */
  if (bossFl) {
    spawnBoss(bossKindForFloor(i), Math.round(CFG.W * 0.68), y - CFG.platT, i, true);
  }
}
/* 宽屏楼层文法：左/中/右三条上升车道，主落脚台 + 四段小台阶 + 侧翼奖励台。
   主路线始终可达；侧翼台只放额外战斗与小奖励，不承担唯一通路，避免软锁。 */
const WIDE_LANE_CYCLE = [0, 1, 2, 1];
function wideLaneCenter(lane) {
  const usable = CFG.W - CFG.wallT * 2;
  return CFG.wallT + usable * ((lane + 0.5) / 3);
}
function wideLaneForFloor(i) { return WIDE_LANE_CYCLE[((i % 4) + 4) % 4]; }
function widePlatX(center, w) {
  return Math.max(CFG.wallT + 4, Math.min(CFG.W - CFG.wallT - 4 - w, Math.round(center - w / 2)));
}
function wideGroundKind(i, pool) {
  if (i === 6 && pool.includes('raider')) return 'raider';
  if (i === 8 && pool.includes('grenadier')) return 'grenadier';
  return pool[Math.floor(rng() * pool.length)];
}
function genFloor(i) {
  const diff = difficultyNow();
  const y = floorY(i);
  const plats = [];
  const bossFl = isBossFloor(i);
  const arenaUpper = isBossArenaUpper(i);
  const full = (i === 0 || i % 10 === 0 || bossFl);
  const lane = wideLaneForFloor(i);
  const nextLane = wideLaneForFloor(i + 1);
  let mainCenter = wideLaneCenter(lane);

  if (bossFl) {
    plats.push({ x: 0, w: CFG.W, y, type: 'boss', landing: true, main: true });
    plats.push({ x: CFG.wallT + 42, w: 124, y: y - 46, type: 'norm', landing: false, arenaWing: true });
    plats.push({ x: CFG.W - CFG.wallT - 42 - 124, w: 124, y: y - 46, type: 'norm', landing: false, arenaWing: true });
    plats.push({ x: Math.round(CFG.W * 0.30), w: 150, y: y - 112, type: 'norm', landing: false, arenaWing: true, heartHigh: true });
    plats.push({ x: Math.round(CFG.W * 0.70) - 150, w: 150, y: y - 112, type: 'norm', landing: false, arenaWing: true, heartHigh: true });
  } else if (arenaUpper) {
    plats.push({ x: Math.round(CFG.W / 2 - 120), w: 240, y, type: 'norm', landing: true, main: true });
    plats.push({ x: CFG.wallT + 48, w: 136, y: y - 46, type: 'norm', landing: false, arenaWing: true });
    plats.push({ x: CFG.W - CFG.wallT - 48 - 136, w: 136, y: y - 46, type: 'norm', landing: false, arenaWing: true });
    plats.push({ x: CFG.wallT + 78, w: 110, y: y - 96, type: 'norm', landing: false, arenaWing: true });
    plats.push({ x: CFG.W - CFG.wallT - 78 - 110, w: 110, y: y - 96, type: 'norm', landing: false, arenaWing: true });
  } else if (full) {
    plats.push({ x: 0, w: CFG.W, y, type: (i > 0 && i % 10 === 0 ? 'gate' : 'norm'), landing: true, main: true });
    mainCenter = CFG.W / 2;
  } else {
    const mainW = 182 + Math.floor(rng() * 28);
    plats.push({ x: widePlatX(mainCenter, mainW), w: mainW, y, type: 'norm', landing: true, main: true });
  }

  if (!bossFl && !arenaUpper) {
    /* 四段小台阶：18px 一级，比旧版更密，但最后一级到下一层仍留 24px 跳口 */
    const startC = full ? CFG.W / 2 : mainCenter;
    const endC = wideLaneCenter(nextLane);
    const rise = 24;
    for (let k = 1; k <= 3; k++) {
      if (k === 2 && rng() < 0.05) continue;
      const u = k / 4;
      const cx = startC + (endC - startC) * u;
      const sw = CFG.stepW + (k === 3 ? 18 : 6 + Math.floor(rng() * 10));
      const t = rng();
      plats.push({
        x: widePlatX(cx, sw), w: sw, y: y - k * rise,
        type: (t < 0.78 ? 'norm' : (t < 0.91 ? 'brit' : 'bounce')),
        landing: false, step: k,
      });
    }
    /* 侧翼台：主路之外的战斗/机关/宝箱空间，拿不到也不影响继续向上 */
    const routeDir = Math.sign(endC - startC) || 1;
    const branchCenter = full
      ? (i % 2 ? CFG.W * 0.78 : CFG.W * 0.22)
      : Math.max(CFG.wallT + 70, Math.min(CFG.W - CFG.wallT - 70, mainCenter - routeDir * 158));
    const branchW = 104 + Math.floor(rng() * 24);
    plats.push({
      x: widePlatX(branchCenter, branchW), w: branchW, y: y - (56 + (i % 3) * 6),
      type: rng() < 0.88 ? 'norm' : 'bounce', landing: false, branch: true,
    });
  }

  for (const p of plats) {
    if (p.y === undefined) p.y = y;
    p.floor = i; p.steps = 2; p.warn = false; p.gone = false;
  }
  if (i > 0 && i % 6 === 0 && i % 10 !== 0 && !bossFl && !arenaUpper) plats[0].pact = true;
  const wall = (i > 0 && (i % 10 !== 0 || bossFl || arenaUpper) && i % 3 !== 0) ? (i % 2 === 0 ? 'R' : 'L') : null;
  S.floors.set(i, { i, y, plats, wall, bossFloor: bossFl, arenaUpper });

  const main = plats[0];
  const branch = plats.find(p => p.branch);
  const trapPool = TRAP_KINDS.filter(k => i >= TRAP_UNLOCK[k] && (k !== 'spikewall' || wall));
  let mainBusy = false, branchBusy = false;
  if (i >= 3 && i % 10 !== 0 && !bossFl && !arenaUpper) {
    let tk = TRAP_DEBUT[i] || null;
    if (tk === 'spikewall' && !wall) tk = 'spike';
    if (!tk && trapPool.length && rng() < Math.min(0.36 + i * 0.014, 0.70) * diff.trap) {
      tk = trapPool[Math.floor(rng() * trapPool.length)];
    }
    if (tk) {
      placeTrap(tk, S.floors.get(i), main, main.x + main.w / 2);
      mainBusy = tk !== 'turret' && tk !== 'spikewall';
    }
    if (branch && i >= 5 && rng() < 0.46 * diff.trap) {
      const extraPool = trapPool.filter(k => k !== 'turret' && k !== 'spikewall');
      if (extraPool.length) {
        const extra = extraPool[Math.floor(rng() * extraPool.length)];
        placeTrap(extra, S.floors.get(i), branch, branch.x + branch.w / 2);
        branchBusy = extra !== 'belt' && extra !== 'ice';
      }
    }
  }

  if (i >= 1 && i % 10 !== 0 && !bossFl && !arenaUpper) {
    const gPool = ['crawl'];
    if (i >= 4) gPool.push('raider');
    if (i >= 7) gPool.push('grenadier');
    const gProb = Math.min(0.94, (i <= 2 ? 0.46 : Math.min(0.52 + i * 0.007, 0.82)) * diff.enemy) * (mainBusy ? 0.6 : 1);
    if (i === 6 || i === 8 || rng() < gProb) {
      const gk = wideGroundKind(i, gPool);
      const span = Math.max(24, main.w - 32);
      spawnMonster(gk === 'crawl' ? 'crawl' : gk, main.x + main.w * 0.5, main.y - CFG.platT - (gk === 'raider' ? 15 : gk === 'grenadier' ? 13 : 8), {
        x0: main.x + 16, x1: main.x + Math.max(18, span), dir: rng() < 0.5 ? 1 : -1,
      });
    }
    if (branch && !branchBusy && (i === 3 || i === 5 || rng() < Math.min(0.9, 0.56 * diff.enemy))) {
      const bk = wideGroundKind(i, gPool);
      spawnMonster(bk, branch.x + branch.w * 0.5, branch.y - CFG.platT - (bk === 'raider' ? 15 : bk === 'grenadier' ? 13 : 8), {
        x0: branch.x + 12, x1: branch.x + branch.w - 12, dir: rng() < 0.5 ? 1 : -1,
      });
    }

    const airPlats = plats.filter(p => !p.landing);
    const airCount = 1 + (i >= 4 && rng() < Math.min(0.82, 0.50 * diff.enemy) ? 1 : 0);
    for (let q = 0; q < airCount; q++) {
      let ak = 'wisp';
      if (i === 2) ak = 'moth';
      else if (i === 4) ak = 'bomber';
      else if (i === 11) ak = 'sniper';
      else {
        const aPool = ['wisp'];
        if (i >= 2) aPool.push('moth');
        if (i >= 4) aPool.push('bomber');
        if (i >= 11) aPool.push('sniper');
        ak = aPool[Math.floor(rng() * aPool.length)];
      }
      const st = airPlats.length ? airPlats[Math.floor(rng() * airPlats.length)] : main;
      const ax = Math.max(CFG.wallT + 22, Math.min(CFG.W - CFG.wallT - 22, st.x + st.w / 2 + (q ? (rng() < 0.5 ? -54 : 54) : 0)));
      const rawAy = st.y - (ak === 'sniper' ? 48 : 40);
      const ceilLim = ((i + 1) % 10 === 0 || isBossFloor(i + 1)) ? floorY(i + 1) + 24 : -Infinity;
      const ay = Math.max(ceilLim, rawAy);
      spawnMonster(ak, ax, ay, { x0: ax, y0: ay });
    }
  }

  if (i >= 10 && rng() < Math.min(0.22, 0.12 * diff.enemy)) {
    const near = S.monsters.filter(m => !m.dead && m.floor === undefined && Math.abs(m.y - y) < 130 && m.kind !== 'boss');
    if (near.length) {
      const m = near[Math.floor(rng() * near.length)];
      m.elite = true; m.hp = m.max = Math.round(m.hp * 1.6); m.dmg = Math.round(m.dmg * 1.2);
    }
  }
  if (i > 0 && i % 8 === 0 && !bossFl && !arenaUpper) {
    const cand = plats.filter(p => !p.landing);
    const p0 = cand.length ? cand[Math.floor(rng() * cand.length)] : main;
    S.chests.push({ x: p0.x + p0.w / 2, y: p0.y - CFG.platT - 10, floor: i, opened: false, t: 0 });
  }
  if (i === 12) S.pickups.push({ id: 'climb', x: main.x + Math.max(20, main.w - 26), y: main.y - CFG.platT - 10, t: 0 });
  if (i > 0 && i % 10 === 0) S.npcs.push({ x: CFG.W - 84, y: y - CFG.platT, floor: i, t: 0 });
  if (bossFl) spawnBoss(bossKindForFloor(i), Math.round(CFG.W * 0.68), y - CFG.platT, i, true);
}
function platsNear() {
  const out = [];
  const f0 = Math.floor(-P.y / CFG.FH) - 2;
  const sealFl = (S.arena && S.arena.active && !S.training) ? S.arena.floor + 1 : Infinity;
  for (let i = f0; i < f0 + 8; i++) {
    if (i > sealFl) continue;
    const f = S.floors.get(i);
    if (f) for (const p of f.plats) if (!p.gone) out.push(p);
  }
  return out;
}
function wallAt(side, y) {
  const i = Math.round(-y / CFG.FH);
  for (let k = i - 1; k <= i + 1; k++) {
    const f = S.floors.get(k);
    if (f && f.wall === side && y <= f.y + 4 && y >= f.y - CFG.FH) return f;
  }
  return null;
}

/* ---------- 战斗 ---------- */
function comboMult() { return Math.min(1 + 0.1 * S.combo, CFG.comboCap); }
function curWeap() { return WEAP[P.slot === 0 ? P.weapon.melee : P.weapon.ranged]; }
function thunderChain(from, dmg) {
  if (!P.runes.includes('thunder') || rng() > 0.3) return;
  let n = 0;
  for (const o of S.monsters) {
    if (o === from || o.dead) continue;
    if (Math.hypot(o.x - from.x, o.y - from.y) < 90) {
      hurt(o, dmg * 0.6, 0, true); float(o.x, o.y - 22, '⚡', PAL.cyan); n++;
      if (n >= 2) break;
    }
  }
}
function explodeAt(x, y, r, dmg, dir) {
  S.eblasts.push({ x, y, r, t: 0.26, life: 0.26, friendly: true });
  burst(x, y, 16, PAL.gold); burst(x, y, 8, PAL.violet);
  S.shake = 4; S.shakeT = 0.12;
  const kd = dir || 1;
  for (const m of S.monsters) if (!m.dead && Math.hypot(m.x - x, m.y - y) < r + mHalf(m).x) hurt(m, dmg, kd, false, true, 'push');
}
/* 伤害来源短标签：静音下也能从飘字读懂"被什么打伤" */
const HURT_SRC = { contact: '魔物', dash: '利刃', shot: '咒弹', trap: '机关', explode: '爆裂', blue: '蓝台', timeout: '反噬', collapse: '崩塌' };
const ESHOT_SRC = { orb: '符蛾咒弹', bolt: '魔瞳狙击', arrow: '弩箭', bomb: '火油爆弹', crescent: '修罗剑气' };
/* 统一受伤基础反馈：血条变化 + 角色闪烁/ squash + 屏闪/震屏 + 受伤音 + 红火花 + 带来源飘字。
   所有有效扣血（怪物/机关/蓝台/反噬…）都走这里，保证基础反馈一致；
   无敌帧与击退仍由各调用方按原设计单独设置（不在此统一）。 */
function hurtFeedback(dmg, reason, o) {
  o = o || {};
  dmg = Math.round(dmg);
  S.hitsTaken = (S.hitsTaken || 0) + 1;
  S.lastDamage = { reason: reason || 'contact', srcTag: o.srcTag || HURT_SRC[reason] || '', dmg, floor: Math.max(0, Math.floor(-P.y / CFG.FH)) };
  if (P.hpTrail === undefined || P.hpTrail < P.hp) P.hpTrail = P.hp;
  P.hpTrailHold = 0.16;
  const minHp = o.minHp !== undefined ? o.minHp : (S.training ? 1 : -Infinity);
  P.hp = Math.max(minHp, P.hp - dmg);
  P.hurtT = o.hurtT !== undefined ? o.hurtT : 0.28;
  P.sx = 1.14; P.sy = 0.88;
  S.flash = Math.max(S.flash, o.flash !== undefined ? o.flash : 0.08);
  S.shake = Math.max(S.shake, o.shake !== undefined ? o.shake : 3);
  S.shakeT = Math.max(S.shakeT, o.shakeT !== undefined ? o.shakeT : 0.1);
  sfx('hurt');
  const col = o.color || PAL.red;
  burst(P.x, P.y - 6, 12, col);
  S.trails.push({ kind: 'hitspark', x: P.x, y: P.y - 6, ang: 0.65, big: true, c: col, t: 0.15, life: 0.15 });
  if (!o.noFloat) {
    const tag = o.srcTag || HURT_SRC[reason] || '';
    float(P.x, P.y - 16, '-' + dmg + (tag ? ' ' + tag : ''), col);
  }
  return dmg;
}
function damagePlayer(dmg, kx, ky, reason, srcTag) {
  if (P.iframe > 0 || P.dead) return false;
  if (S.emberShield) {
    S.emberShield = false;
    P.iframe = 1.0;
    S.flash = 0.10; S.shake = 5; S.shakeT = 0.14; sfx('parry');
    burst(P.x, P.y, 18, PAL.gold);
    S.trails.push({ kind: 'ring', x: P.x, y: P.y, t: 0.28, r: 14 });
    float(P.x, P.y - 22, '余烬圣盾格挡！', PAL.gold);
    explodeAt(P.x, P.y, 68, Math.round(28 * P.atkMul), P.face);
    return false;
  }
  hurtFeedback(dmg, reason || 'contact', srcTag ? { srcTag } : undefined);
  P.iframe = CFG.iframes;
  if (kx !== undefined) P.vx = kx;
  if (ky !== undefined) P.vy = ky;
  if (!S.training && P.hp <= 0) die(reason || 'contact', srcTag);
  return true;
}
function enemyExplode(x, y, r, dmg, hurtPlayer, srcTag) {
  S.eblasts.push({ x, y, r, t: 0.30, life: 0.30 });
  burst(x, y, 16, PAL.red); burst(x, y, 10, PAL.gold);
  S.shake = Math.max(S.shake, 5); S.shakeT = 0.14; sfx('explode');
  if (hurtPlayer && Math.hypot(P.x - x, P.y - y) < r + 6) {
    damagePlayer(dmg, (Math.sign(P.x - x) || -P.face) * 185, -235, 'explode', srcTag || '爆裂冲击');
  }
  for (const o of S.monsters) {
    if (o.dead || o.kind === 'dummy' || o.kind === 'boss') continue;
    if (Math.hypot(o.x - x, o.y - y) < r + mHalf(o).x) {
      hurt(o, Math.round(dmg * 1.1), Math.sign(o.x - x) || 1, true, true, 'push');
    }
  }
}
function slashEnemyShots(W) {
  let cut = 0;
  for (const es of S.eshots) {
    if (es.t <= 0 || !es.slashable) continue;
    const dx = es.x - P.x, dy = es.y - P.y;
    if (dx * P.face > -14 && Math.abs(dx) < W.arcW + 12 && Math.abs(dy) < W.arcH + 12) {
      es.t = 0; cut++;
      S.trails.push({ kind: 'slashpop', x: es.x, y: es.y, t: 0.16, life: 0.16 });
      burst(es.x, es.y, 6, PAL.cyan);
    }
  }
  if (cut > 0) sfx('parry');
  return cut;
}
function nearestMonster(range) {
  let best = null, bd = range;
  for (const m of S.monsters) if (!m.dead) { const d = Math.hypot(m.x - P.x, m.y - P.y); if (d < bd) { bd = d; best = m; } }
  return best;
}
function burst(x, y, n, c, soul) {
  for (let i = 0; i < n; i++) {
    if (soul) {
      S.parts.push({ x: x + (rng() - 0.5) * 14, y: y + (rng() - 0.5) * 10, vx: (rng() - 0.5) * 42, vy: -35 - rng() * 55, grav: -38, soul: true, t: 0.55 + rng() * 0.35, c, s: 3 });
    } else {
      S.parts.push({ x, y, vx: (rng() - 0.5) * 235, vy: (rng() - 0.72) * 230, grav: 600, t: 0.38 + rng() * 0.32, c, hi: i % 3 === 0, s: 2 + Math.floor(rng() * 3) });
    }
  }
}
function float(x, y, txt, c) { S_FLOAT.push({ x, y, txt, c, t: 0.7 }); }
const RUNE_NAME = { climb: '攀爬符', ice: '冰符', thunder: '雷符', feather: '羽符', lamp: '灯符' };
function addRune(id) {
  if (P.runes.includes(id)) { float(P.x, P.y - 24, '已有' + RUNE_NAME[id], PAL.mut); return false; }
  P.runes.push(id);
  const cap = CFG.runeSlots || 2;
  if (P.runes.length > cap) { const out = P.runes.shift(); float(P.x, P.y - 30, '替换' + RUNE_NAME[out], PAL.mut); }
  float(P.x, P.y - 30, '+' + RUNE_NAME[id], PAL.violet);
  if (id === 'lamp') { S.chests.push({ x: P.x + 30, y: P.y - 8, floor: Math.floor(-P.y / CFG.FH), opened: false, t: 0 }); }
  if (id === 'feather') P.airBonus = 1;
  hintOnce('rune', '符文已生效：' + RUNE_NAME[id] + (useTouch() ? '' : ' · 按 ' + bindingLabel('panel') + ' 查看效果'), PAL.violet);
  sfx('rune');
  return true;
}
function swapWeaponSlot() {
  P.slot = 1 - P.slot; P.drawWeapT = 0.18; P.sheatheT = 0; P.atkBuf = 0;
  sfx('ui'); weaponHint(P.slot);
  hintOnce('swap', '已切换为' + (P.slot === 0 ? '近战：点按挥击' : '远程：长按连射'), PAL.cyan);
}
function cycleWeapon() {
  const key = P.slot === 0 ? 'melee' : 'ranged';
  const arr = P.owned[key];
  if (arr.length < 2) { toast('当前只有一把' + (P.slot === 0 ? '近战' : '远程') + '武器 · 可切换近战 / 远程', PAL.mut); return; }
  const i = arr.indexOf(P.weapon[key]);
  P.weapon[key] = arr[(i + 1) % arr.length];
  P.drawWeapT = 0.18; P.sheatheT = 0;
  float(P.x, P.y - 26, WEAP[P.weapon[key]].name, PAL.gold); sfx('ui');
}
function gainXp(n) {
  S.xp += n;
  while (P.lv < GROW.cap && S.xp >= LV_XP[P.lv - 1]) {
    S.xp -= LV_XP[P.lv - 1]; P.lv++;
    P.atkMul = +(1 + GROW.atk * (P.lv - 1)).toFixed(2);
    P.spdMul = +(1 + GROW.spd * (P.lv - 1)).toFixed(2);
    CFG.hpMax += GROW.hp; P.hp = Math.min(CFG.hpMax, P.hp + GROW.hp);
    float(P.x, P.y - 18, 'LV' + P.lv, PAL.gold);
    burst(P.x, P.y, 12, PAL.gold);
    sfx('level');
  }
}
function applyKnock(m, kind, dir) {
  if (!m || m.dead) return;
  if (m.kind === 'dummy' || m.kind === 'boss' || m.kind === 'turret') return; /* 木偶、Boss 与墙装弩机不被击飞 */
  if (m.kbT > 0) return;                     /* 空中不重复重置，保证落回原高度 */
  m.kbKind = kind;
  if (kind === 'launch') {
    /* 抛物线回到原高度：T=0.42s，vy=-gT/2；纯纵向击飞并打断蓄力/锁定 */
    m.kbT = 0.42; m.kbVx = 0; m.kbVy = -305; m.kbG = 1450;
    m.charge = 0;
    if (m.state === 'aim' || m.state === 'track' || m.state === 'lock' || m.state === 'throw') {
      m.state = m.kind === 'raider' ? 'patrol' : 'idle';
      m.cd = Math.max(m.cd || 0, 0.9);
    }
    burst(m.x, m.y + mHalf(m).y * 0.5, 6, PAL.stone2);
  } else {
    /* 击退：横向推开，轻微上抛后落回 */
    m.kbT = 0.26; m.kbVx = dir * 200; m.kbVy = -78; m.kbG = 600;
  }
}
function hurt(m, dmg, kx, noChain, light, kb) {
  dmg = Math.round(dmg);
  if (m.hpTrail === undefined || m.hpTrail < m.hp) m.hpTrail = m.hp;
  m.hpTrailHold = 0.14;
  if (m.kind === 'dummy') {
    m.hp -= dmg; m.flash = 0.12; m.hitT = 0.28; m.kbKind = kb || null;
    if (kb) m.hitT = kb === 'launch' ? 0.42 : 0.34;
    const st = S.trainingStats;
    if (st) {
      st.dmg += dmg; st.hits++; st.last = dmg;
      if (!st.marks) st.marks = [];
      st.marks.push({ t: st.time, v: dmg });
      while (st.marks.length && st.time - st.marks[0].t > 5) st.marks.shift();
    }
    float(m.x + (rng() - 0.5) * 10, m.y - 38, '-' + dmg, PAL.hi);
    sfx('hit');
    S.hitstop = light ? 0.025 : CFG.hitstop;
    S.shake = light ? Math.max(2, CFG.shakePx - 1) : CFG.shakePx; S.shakeT = CFG.shakeT;
    S.trails.push({ kind: 'hitspark', x: m.x + (rng() - 0.5) * 8, y: m.y - 8 + (rng() - 0.5) * 8, ang: (rng() - 0.5) * 0.8, big: dmg >= 22, c: PAL.gold, t: 0.14, life: 0.14 });
    burst(m.x, m.y, 10, PAL.gold);
    if (kb === 'launch') burst(m.x, m.y + 16, 7, PAL.stone2);
    if (m.hp <= 0) {
      m.hp = m.max; m.hpTrail = m.max;
      toast('木偶打断了，重新立好', PAL.gold);
      burst(m.x, m.y, 18, PAL.gold);
      sfx('level');
    }
    return;
  }
  m.hp -= dmg; m.flash = 0.12;
  float(m.x, m.y - 14, '-' + dmg, PAL.hi);
  sfx('hit');
  S.hitstop = light ? 0.025 : CFG.hitstop;
  S.shake = light ? Math.max(2, CFG.shakePx - 1) : CFG.shakePx; S.shakeT = CFG.shakeT;
  S.trails.push({ kind: 'hitspark', x: m.x + (rng() - 0.5) * 8, y: m.y - 4 + (rng() - 0.5) * 8, ang: (rng() - 0.5) * 0.8, big: dmg >= 22 || m.kind === 'boss', c: PAL.red, t: 0.15, life: 0.15 });
  burst(m.x, m.y, 11, PAL.red);
  /* 怪物受击物理反冲：彻底告别无硬直顶刀换血，击退位移并打断非霸体冲撞 */
  const pushDir = kx || Math.sign(m.x - P.x) || (P.face || 1);
  if (m.kind !== 'boss' && m.kind !== 'dummy' && m.kind !== 'turret') {
    if (kb || dmg >= 20 || P.slamming || P.weapon.melee === 'hammer') {
      applyKnock(m, kb || 'launch', pushDir);
    } else if (!m.kbT || m.kbT <= 0) {
      applyKnock(m, 'push', pushDir);
      m.charge = 0;
      m.calm = Math.max(m.calm || 0, 0.14);
    }
    // 瞬时微量位移缓冲
    m.x += pushDir * (dmg >= 20 ? 8 : 5);
  }
  if (!noChain) thunderChain(m, dmg);
  if (m.hp <= 0) {
    if (m.kind === 'boss') {
      m.hp = 0; m.dead = true; S.kills++; S.combo++; S.comboT = CFG.comboWin;
      resolveBossVictory(m);
      return;
    }
    m.dead = true; S.kills++; S.combo++; S.comboT = CFG.comboWin; sfx('kill');
    const fr = Math.max(0, Math.floor(-P.y / CFG.FH));
    const cnt = S.floorKills[fr] = (S.floorKills[fr] || 0) + 1;
    const capMul = cnt <= 3 ? 1 : 0.3;
    const base = REWARD[m.kind] || [10, 2];
    const xpGain = Math.round(base[0] * capMul);
    const coinGain = Math.round(base[1] * capMul * (m.elite ? 3 : 1) * comboMult() * depthMul(fr));
    /* 经验与金币改为掉落，回收后入账 */
    S.drops.push({ kind: 'xp', v: xpGain, x: m.x, y: m.y, vx: (rng() - 0.5) * 60, vy: -140 - rng() * 60, t: 0, delay: 0.18 });
    const pieces = Math.min(4, Math.max(1, Math.round(coinGain / 2)));
    let left = coinGain;
    for (let i = 0; i < pieces; i++) {
      const v = i === pieces - 1 ? left : Math.max(1, Math.floor(coinGain / pieces));
      left -= v;
      S.drops.push({ kind: 'coin', v, x: m.x, y: m.y, vx: (rng() - 0.5) * 120, vy: -160 - rng() * 80, t: 0, delay: 0.22 + rng() * 0.1 });
    }
    S.trails.push({ kind: 'soulring', x: m.x, y: m.y, t: 0.22, life: 0.22, r: 8 });
    burst(m.x, m.y, 14, PAL.red2);
    burst(m.x, m.y - 4, 5, PAL.cyan, true);
    if (m.kind === 'bomber') enemyExplode(m.x, m.y, 44, 24, false);
    if (rng() < 0.12 && P.hp < CFG.hpMax) S.orbs.push({ x: m.x, y: m.y, t: 0 });
    if (rng() < 0.06) S.orbs.push({ x: m.x, y: m.y, t: 0, shard: true });
  }
}
function doAttack() {
  const key = P.slot === 0 ? P.weapon.melee : P.weapon.ranged;
  const W = WEAP[key];
  if (P.atkCd > 0) {
    /* 近战点按缓冲：收招前 0.25s 内按下的下一击不吞，冷却一结束立即接上 */
    if (W.slot === 'melee' && P.atkCd <= 0.25) P.atkBuf = 0.25;
    return;
  }
  P.atkCd = W.cd;
  P.atkCount++;
  P.anim.atkDur = W.anim || (W.slot === 'melee' ? (W.splash ? 0.5 : 0.3) : (W.explode ? 0.36 : 0.28));
  P.anim.atk = P.anim.atkDur;
  P.anim.atkW = key;
  P.sheatheT = 0; P.drawWeapT = 0; P.slamLandT = 0;
  if (W.slot === 'melee') {
    if (key === 'ember') sfx('emberswing');
    else if (key === 'long') sfx('longswing');
    else sfx(W.splash ? 'hammer' : 'swing');
  }
  const tgt = nearestMonster(160);
  if (tgt) P.face = tgt.x >= P.x ? 1 : -1;
  /* 打击帧结算：对齐到动画第 1 帧（dur×0.25），保证"挥到才掉血" */
  const dur = P.anim.atkDur;
  P.atkPending = {
    t: dur * (W.slot === 'melee' ? 0.25 : 0.34) + 0.005,
    key, dmg: W.dmg * P.atkMul * comboMult() * (P.furyT > 0 ? 1.4 : 1), W,
  };
}
function executeStrike(p) {
  const W = p.W;
  P.anim.f = Math.max(P.anim.f, 1);   /* 命中瞬间进入打击姿势 */
  if (W.slot === 'melee') {
    let hitEnemy = false;
    slashEnemyShots(W);
    for (const m of S.monsters) if (!m.dead) {
      const dx = m.x - P.x, dy = m.y - P.y, hb = mHalf(m);
      if (Math.abs(dy) < W.arcH + hb.y && dx * P.face > -8 && Math.abs(dx) < W.arcW + hb.x) { hurt(m, p.dmg, P.face, false, false, W.splash ? 'launch' : null); hitEnemy = true; if (S.tut) S.tut.attacked = true; }
    }
    if (W.splash) {
      S.shake = CFG.shakePx + 2; S.shakeT = CFG.shakeT;
      for (const m of S.monsters) if (!m.dead && Math.abs(m.x - P.x) < W.splash + mHalf(m).x && m.y > P.y && m.y - P.y < 60 + mHalf(m).y) {
        hurt(m, p.dmg * 0.7, Math.sign(m.x - P.x), false, false, 'launch'); hitEnemy = true; if (S.tut) S.tut.attacked = true;
      }
      burst(P.x, P.y + 12, 10, PAL.gold);
      S.trails.push({ kind: 'slamwave', x: P.x + P.face * 18, y: P.y + 14, t: 0.22, life: 0.22, r: 42 });
    }
    burst(P.x + P.face * W.arcW * 0.6, P.y - 12, 6, p.key === 'long' ? PAL.red : (W.splash ? PAL.gold : PAL.cyan));
    if (p.key === 'knife') {
      S.trails.push({ kind: 'thrust', x: P.x, y: P.y - 2, face: P.face, t: 0.13, life: 0.13, len: 48, h: 30 });
      S.trails.push({ kind: 'chop', x: P.x, y: P.y - 2, face: P.face, t: 0.12, life: 0.12, delay: 0.075, big: false });
    } else if (p.key === 'long') {
      S.trails.push({ kind: 'chop', x: P.x + P.face * 8, y: P.y - 2, face: P.face, t: 0.16, life: 0.16, big: false, long: true, crimson: true });
    } else if (p.key === 'ember') {
      /* 烬铁巨剑专属：巨型烈火弧月刀罡 + 熔金地裂 + 漫天飞射余烬与浮灰 */
      if (hitEnemy) sfx('emberimpact');
      S.trails.push({ kind: 'ember_cleave', x: P.x + P.face * 18, y: P.y - 4, face: P.face, t: 0.24, life: 0.24, len: W.arcW, h: W.arcH });
      S.trails.push({ kind: 'slamwave', x: P.x + P.face * 28, y: P.y + 14, t: 0.26, life: 0.26, r: 46, c: '#ebb34b' });
      S.trails.push({ kind: 'ember_crack', x: P.x + P.face * 30, y: P.y + 14, face: P.face, t: 0.5, life: 0.5, len: 82 });
      for (let i = 0; i < 13; i++) {
        const spd = 60 + Math.random() * 140, a = (Math.random() - 0.5) * 1.2;
        S.parts.push({
          x: P.x + P.face * (16 + Math.random() * 34),
          y: P.y - 6 + (Math.random() - 0.5) * 22,
          vx: P.face * Math.cos(a) * spd,
          vy: Math.sin(a) * spd - 70,
          r: 2 + Math.random() * 2.5,
          c: Math.random() < 0.55 ? '#ebb34b' : (Math.random() < 0.6 ? '#e03c31' : '#f4ecdc'),
          life: 0.35 + Math.random() * 0.3,
          maxLife: 0.65
        });
      }
      /* 缓慢上浮的浮灰（与火星区分：暗灰、慢、久） */
      for (let i = 0; i < 4; i++) {
        S.parts.push({
          x: P.x + P.face * (10 + Math.random() * 40),
          y: P.y - 4 + Math.random() * 12,
          vx: P.face * (10 + Math.random() * 20),
          vy: -18 - Math.random() * 22,
          r: 1.5 + Math.random() * 1.5,
          c: 'rgba(154,143,128,0.8)',
          life: 0.7 + Math.random() * 0.4,
          maxLife: 1.1
        });
      }
    } else {
      S.trails.push({ kind: 'arc', x: P.x, y: P.y - 2, face: P.face, t: 0.15, life: 0.15, big: !!W.splash, len: W.arcW, h: W.arcH });
    }
  } else {
    sfx(W.explode ? 'orbcast' : 'shoot');
    S.trails.push({ kind: 'muzzle', x: P.x + P.face * 16, y: P.y - 9, face: P.face, t: 0.09, orb: !!W.explode });
    S.shots.push({
      x: P.x + P.face * 10, y: P.y - 9, vx: P.face * W.speed,
      vy: W.grav ? -80 : 0, grav: W.grav || 0, explode: W.explode || 0,
      dmg: p.dmg, t: 1.6,
    });
  }
}
function doSlam() {
  if (P.onGround || P.slamming) return;
  P.slamming = true; P.slamT = 0; P.slamLandT = 0;
  P.sx = 0.92; P.sy = 1.08;
  P.vy = CFG.slamV; P.vx = 0; sfx('dive');
}
function doDodge() {
  if (P.dead || S.screen !== 'playing' || S.shopOpen || S.bossRewardOpen || S.panel || S.paused || S.helpOpen) return;
  if (P.dodgeT > 0 || P.dodgeCd > 0) return;
  /* 下砸启动前摇（0.14s）内允许紧急闪避打断，消除误操作自杀坠深渊死穴 */
  if (P.slamming) {
    if ((P.slamT || 0) < 0.14) {
      P.slamming = false;
      P.slamT = 0;
    } else {
      return;
    }
  }
  if (!P.onGround) { if (P.airDodge) return; P.airDodge = true; }
  const dir = IN.ax !== 0 ? Math.sign(IN.ax) : P.face;
  P.dodgeDir = dir; P.dodgeT = CFG.dodge.dur; P.dodgeCd = CFG.dodge.cd * (S.dodgeCdMul || 1);
  P.iframe = Math.max(P.iframe, CFG.dodge.iframe);
  P.vy = Math.min(P.vy, 0) * 0.2;
  P.vx = dir * CFG.dodge.speed;
  P.slamLandT = 0;
  S.trails.push({ kind: 'dash', x: P.x, y: P.y, face: dir, t: 0.22, life: 0.22 });
  burst(P.x, P.y + 6, 6, PAL.cyan);
  if (S.tut) S.tut.dodged = true;
  sfx('dodge');
  float(P.x, P.y - 22, '闪', PAL.cyan);
}
function slamImpact() {
  P.slamming = false; P.slamT = 0; P.slamLandT = 0.18;
  P.sx = 1.22; P.sy = 0.78; P.landT = 0.14;
  S.hitstop = CFG.hitstop; S.shake = CFG.shakePx + 2; S.shakeT = CFG.shakeT;
  sfx('slam');
  burst(P.x, P.y + 10, 16, PAL.gold);
  burst(P.x, P.y + 12, 8, PAL.red);
  S.trails.push({ kind: 'ring', x: P.x, y: P.y + 8, t: 0.28, r: 10 });
  S.trails.push({ kind: 'slamwave', x: P.x, y: P.y + 13, t: 0.28, life: 0.28, r: CFG.shockR });
  for (const m of S.monsters) if (!m.dead && Math.hypot(m.x - P.x, m.y - P.y) < CFG.shockR + mHalf(m).x) hurt(m, CFG.slamDmg * P.atkMul * comboMult() * (P.furyT > 0 ? 1.4 : 1), Math.sign(m.x - P.x));
  for (const p of platsNear()) if (p.type === 'brit' && !p.landing && Math.abs(p.y - (P.y + 12)) < 20 && P.x > p.x - 8 && P.x < p.x + p.w + 8) p.steps = 0;
}
/* 动作状态机：优先级 死亡 > 闪避 > 攻击 > 下砸 > 受击 > 攀爬 > 贴墙 > 空中 > 跑 > 待机 */
function updateAnim(dt) {
  const a = P.anim;
  const prevAtk = a.atk || 0;
  if (prevAtk > 0) {
    a.atk = Math.max(0, prevAtk - dt);
    if (a.atk <= 0) { P.sheatheT = 0.22; P.sheatheW = a.atkW; }
  }
  let st;
  if (P.dead) st = 'dead';
  else if (P.dodgeT > 0) st = 'dodge';
  else if (a.atk > 0) st = 'attack';
  else if (P.slamming) st = 'slam';
  else if (P.hurtT > 0) st = 'hurt';
  else if (P.climbing) st = 'climb';
  else if (P.wall !== 0) st = 'wallslide';
  else if (!P.onGround) st = P.vy < 0 ? 'jump' : 'fall';
  else if (Math.abs(P.vx) > 20) st = (P.hp <= CFG.hpMax * 0.3) ? 'walk' : 'run';
  else st = 'idle';
  if (a.st !== st) { a.st = st; a.t = 0; }
  a.t += dt;
  if (st === 'attack') {
    const dur = a.atkDur || 0.3;
    const prog = Math.max(0, Math.min(1, 1 - a.atk / dur));
    const n = (ATK_IMGS[a.atkW] && ATK_IMGS[a.atkW].length) ? ATK_IMGS[a.atkW].length : 3;
    if (n === 4) a.f = prog < 0.20 ? 0 : prog < 0.48 ? 1 : prog < 0.78 ? 2 : 3;
    else a.f = prog < 0.26 ? 0 : prog < 0.64 ? 1 : Math.min(n - 1, 2);
  } else {
    const T = ANIM[st] || ANIM.idle;
    a.f = Math.floor(a.t / T.frame) % T.frames;
  }
  if ((st === 'run' || st === 'walk') && P.onGround) {
    const mark = st === 'run' ? (a.f === 0 || a.f === 4) : (a.f === 2 || a.f === 6);
    if (mark && P.stepF !== a.f) { P.stepF = a.f; sfx('step', { pan: (P.x / CFG.W) * 2 - 1, pitch: 0.9 + Math.random() * 0.2 }); }
    else if (!mark) P.stepF = -1;
  }
  if (st === 'idle') S.idleT += dt; else S.idleT = 0;
  if (st === 'run') a.runPhase += Math.abs(P.vx) * dt;
  const airLean = !P.onGround ? Math.min(0.72, Math.abs(P.vx) / CFG.runMax * 0.68) : 0;
  const leanTarget = (st === 'hurt' || P.skidT > 0) ? 0 : (st === 'run' || st === 'dodge') ? 1 : st === 'walk' ? 0.52 : airLean;
  const rate = leanTarget > S.lean ? 5.5 : 14;
  const dl = leanTarget - S.lean;
  S.lean += Math.max(-dt * rate, Math.min(dt * rate, dl));
}

/* ---------- 死亡与重开 ---------- */
function die(reason, srcTag) {
  if (P.dead || S.screen !== 'playing') return;
  P.dead = true; S.deathT = 0; S.deaths++; S.combo = 0; S.deathFrame = S.frames; sfx('death');
  syncTrackA();
  syncMusicDuck();
  S.lastDeath = reason || 'unknown';
  if (srcTag || !S.lastDamage || S.lastDamage.reason !== S.lastDeath) {
    S.lastDamage = { reason: S.lastDeath, srcTag: srcTag || HURT_SRC[S.lastDeath] || '', dmg: 0, floor: Math.max(0, Math.floor(-P.y / CFG.FH)) };
  }
  S.deathCounts[S.lastDeath] = (S.deathCounts[S.lastDeath] || 0) + 1;
  S.deadPending = (S.meta.revive && !S.reviveUsed) ? 'revive' : 'end';
  burst(P.x, P.y, 18, PAL.hi);
}
function respawn() {
  const cp = S.checkpoint;
  P.x = cp.x; P.y = cp.y - Math.round(P.h / 2) - 4; P.vx = 0; P.vy = 0; P.dead = false; P.hp = CFG.hpMax; sfx('revive');
  P.iframe = 1.5; P.slamming = false; P.jumps = 0; P.dodgeT = 0; P.dodgeCd = 0; P.airDodge = false; P.atkPending = null; P.atkBuf = 0;
  P.sx = 1; P.sy = 1; P.landT = 0; P.skidT = 0; P.hurtT = 0; P.slamT = 0; P.slamLandT = 0; P.sheatheT = 0; P.drawWeapT = 0;
  /* 重生点安全规则：清空敌弹与竞技场机关；若在 Boss 封锁战中复活回下层检查点，重置该层 Boss 待再次挑战 */
  S.eshots = []; S.eblasts = []; S.arenaHazards = [];
  if (S.arena && cp.floor < S.arena.floor) {
    const ab = S.arena.boss;
    if (ab && !ab.dead) { ab.dormant = true; ab.hp = ab.max; ab.phase = 1; ab.x = ab.x0; ab.y = ab.y0; ab.bstate = 'idle'; }
    delete S.bossDone[S.arena.floor];
    S.arena = null; S.boss = null;
  }
  for (const tp of S.traps) if (tp.kind === 'rock') { tp.state = 'idle'; tp.y = tp.y0; tp.vy = 0; }
  for (const m of S.monsters) {
    if (!m.dead && m.kind !== 'boss' && Math.hypot(m.x - cp.x, m.y - cp.y) < 150) {
      m.x = m.x0; m.y = m.y0; m.calm = 3; m.charge = 0;
      m.state = m.kind === 'raider' ? 'patrol' : 'idle';
    }
  }
  S.collapseY = floorY(cp.floor) + 2 * CFG.FH;
  /* 规则同步：前线回滚后，新前线以上的平台必须恢复，否则留下永久空洞 */
  for (let i = Math.max(0, cp.floor - 2); i <= cp.floor + 6; i++) {
    const f = S.floors.get(i); if (!f) continue;
    for (const p of f.plats) if (p.y < S.collapseY) { p.gone = false; p.steps = 2; p.warn = false; }
  }
  S.cam = P.y - CFG.H * CFG.camAnchor;
  S.restartFrames = S.frames - S.deathFrame;
}

/* ---------- 镇楼 Boss 封锁竞技场、四魔物招式 AI 与限时悬赏奖惩 ---------- */
function segDist(px0, py0, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  if (l2 <= 1) return Math.hypot(px0 - x1, py0 - y1);
  const t = Math.max(0, Math.min(1, ((px0 - x1) * dx + (py0 - y1) * dy) / l2));
  return Math.hypot(px0 - (x1 + t * dx), py0 - (y1 + t * dy));
}

function startBossArena(fl, b) {
  if (!b || b.dead || S.arena) return;
  syncTrackA(true);
  ensureFloors(fl + 2);
  const meta = BOSS_META[b.bkind] || BOSS_META.colossus;
  const botY = floorY(fl) - CFG.platT;
  const topY = floorY(fl) - 208;
  b.dormant = false; b.bstate = 'idle'; b.btimer = 0.72;
  if (Math.abs(P.x - b.x) < 42) {
    b.x = P.x < CFG.W / 2 ? CFG.W - 84 : 84;
    b.x0 = b.x;
  }
  b.dir = P.x >= b.x ? 1 : -1;
  if (P.y + P.h / 2 > botY) { P.y = botY - P.h / 2; P.vy = Math.min(0, P.vy); P.onGround = true; }
  if (P.y - P.h / 2 < topY + 10) { P.y = topY + 10 + P.h / 2; P.vy = Math.max(0, P.vy); }
  S.eshots = []; S.eblasts = []; S.arenaHazards = [];
  S.boss = b;
  S.arena = {
    floor: fl, bkind: b.bkind, boss: b, active: true,
    topY, botY, timeLeft: meta.time, timeMax: meta.time, tickSec: 8,
  };
  if (S.collapseOn) S.collapseY = Math.max(S.collapseY, floorY(fl) + 1.8 * CFG.FH);
  S.banner = { t: 2.8, floor: fl, text: meta.title, mech: '上下结界已封锁 · 限时 ' + meta.time + ' 秒讨伐悬赏', boss: true, c: meta.c };
  S.shake = 6; S.shakeT = 0.20; S.flash = 0.09;
  burst(b.x, b.y, 22, meta.c);
  sfx('bossseal'); sfx('boss');
}

function rollBossRewards() {
  const pool = [];
  if (!P.owned.melee.includes('hammer')) {
    pool.push({
      id: 'weap_hammer', title: '神兵·震岳铁锤', tag: '重装解锁', c: PAL.red, icon: 'hammer',
      desc: '将近战替换为【铁锤】（26 伤范围震地），仍只带两把，且全武器攻击 +10%',
      apply() {
        P.owned.melee = ['hammer']; P.weapon.melee = 'hammer'; P.slot = 0; P.drawWeapT = 0.22;
        P.atkMul = +(P.atkMul + 0.10).toFixed(2);
      },
    });
  }
  if (!P.owned.ranged.includes('orb')) {
    pool.push({
      id: 'weap_orb', title: '秘宝·湮灭法球', tag: '秘术解锁', c: PAL.cyan, icon: 'orb',
      desc: '将远程替换为【法球】（高爆范围远程），仍只带两把，且全武器攻击 +10%',
      apply() {
        P.owned.ranged = ['orb']; P.weapon.ranged = 'orb'; P.slot = 1; P.drawWeapT = 0.22;
        P.atkMul = +(P.atkMul + 0.10).toFixed(2);
      },
    });
  }
  const common = [
    {
      id: 'titan_blood', title: '巨像血脉', tag: '生存强化', c: PAL.green, icon: 'revive',
      desc: '最大生命上限 +25，并立即恢复 40 点生命值',
      apply() { CFG.hpMax += 25; P.hp = Math.min(CFG.hpMax, P.hp + 40); },
    },
    {
      id: 'shura_edge', title: '修罗战意', tag: '极致锋芒', c: PAL.red, icon: 'sword',
      desc: '本局近战与远程攻击伤害永久提升 +22%',
      apply() { P.atkMul = +(P.atkMul + 0.22).toFixed(2); },
    },
    {
      id: 'gale_step', title: '疾风神行', tag: '身法蜕变', c: PAL.cyan, icon: 'wing',
      desc: '移动速度 +12%，且闪避冷却时间缩短 25%',
      apply() { P.spdMul = +(P.spdMul + 0.12).toFixed(2); S.dodgeCdMul = +((S.dodgeCdMul || 1) * 0.75).toFixed(3); },
    },
    {
      id: 'ember_aegis', title: '余烬圣盾', tag: '免死反震', c: PAL.gold, icon: 'shield',
      desc: '展开圣盾抵挡下一次任意伤害并震爆周围敌群，且攻击 +12%',
      apply() { S.emberShield = true; P.atkMul = +(P.atkMul + 0.12).toFixed(2); },
    },
    {
      id: 'rune_crown', title: '镇塔铭刻', tag: '秘符扩容', c: PAL.violet, icon: 'slot',
      desc: '符文槽上限 +1（至多 4 槽），并随机赐予一枚未持有符文',
      apply() {
        CFG.runeSlots = Math.min(4, (CFG.runeSlots || 2) + 1);
        const ids = ['climb', 'ice', 'thunder', 'feather', 'lamp'].filter(k => !P.runes.includes(k));
        if (ids.length) addRune(ids[Math.floor(rng() * ids.length)]);
        else { S.coins += 25; float(P.x, P.y - 24, '+25金', PAL.gold); }
      },
    },
    {
      id: 'gold_pact', title: '黄金圣契', tag: '悬赏重金', c: PAL.gold, icon: 'coin',
      desc: '立即入账 +60 金币、+300 讨伐积分，并恢复 35 点生命',
      apply() { S.coins += 60; S.score += 300; P.hp = Math.min(CFG.hpMax, P.hp + 35); },
    },
  ];
  /* 洗牌抽取 3 张不重复卡片；若有未解锁重武，优先保底进 1 张 */
  const out = [];
  if (pool.length > 0) out.push(pool[Math.floor(rng() * pool.length)]);
  const bag = common.slice();
  while (out.length < 3 && bag.length > 0) {
    const idx = Math.floor(rng() * bag.length);
    out.push(bag.splice(idx, 1)[0]);
  }
  return out;
}

function chooseBossReward(idx) {
  if (!S.bossRewardOpen) return false;
  const card = S.bossRewards[idx];
  if (!card) return false;
  card.apply();
  S.bossRewardOpen = false;
  S.bossRewards = [];
  P.iframe = Math.max(P.iframe, 1.0);
  S.flash = 0.08;
  burst(P.x, P.y, 18, card.c || PAL.gold);
  sfx('boon');
  toast('已获赐福：【' + card.title + '】· 结界已开，继续向上！', card.c || PAL.gold);
  /* 30F / 60F 重叠门楼：选完战利品后无缝衔接守门吏补给 */
  if (S.pendingGate > 0 && S.lastGate !== S.pendingGate) {
    const gf = S.pendingGate;
    S.pendingGate = -1;
    S.lastGate = gf;
    openGate(gf);
  }
  return true;
}

function resolveBossVictory(b) {
  const fl = b.floor || (S.arena ? S.arena.floor : Math.max(0, Math.floor(-P.y / CFG.FH)));
  syncTrackA();
  const meta = BOSS_META[b.bkind] || BOSS_META.colossus;
  const usedSec = S.arena ? Math.max(0.1, S.arena.timeMax - S.arena.timeLeft) : 0;
  S.arena = null; S.arenaHazards = []; S.boss = null;
  S.eshots = []; S.eblasts = [];
  /* 清理召唤出的残余自爆蝠 */
  for (const o of S.monsters) if (!o.dead && o !== b && o.kind !== 'dummy' && Math.abs(o.y - b.y) < 180) o.dead = true;
  burst(b.x, b.y, 32, meta.c);
  burst(b.x, b.y, 20, PAL.gold);
  S.shake = 8; S.shakeT = 0.24; S.flash = 0.16;
  sfx('bossdown'); sfx('bossopen');

  if (S.training) {
    P.hp = CFG.hpMax;
    toast('试炼讨伐成功！耗时 ' + usedSec.toFixed(1) + 's · 按 B 迎战下一尊 Boss', PAL.gold);
    return;
  }

  if (b.bkind === 'heart') {
    S.bossDone[fl] = 'win';
    S.bossKills++;
    S.heartMarks = (S.heartMarks || 0) + 100;
    S.coins += 50;
    S.score += 750;
    P.hp = CFG.hpMax;
    P.iframe = 1.2;
    S.bossPenaltyT = 0; S.collapseMul = 1;
    S.heartRule = null; S.dark = false;
    S.meta.heartClears = (S.meta.heartClears || 0) + 1;
    saveMeta();
    const nextY = floorY(fl + 1);
    P.x = CFG.W / 2;
    P.y = nextY - CFG.platT - P.h / 2 - 1;
    P.vx = 0; P.vy = 0; P.onGround = true;
    S.checkpoint = { floor: fl + 1, x: P.x, y: nextY - CFG.platT };
    S.lastFloorSeen = Math.max(S.lastFloorSeen, fl + 1);
    S.collapseY = nextY + 2 * CFG.FH;
    S.banner = { t: 4.2, floor: fl, text: '心停了。楼，还在长。', mech: '印记 +100 · 金币 +50 · 满血 · 76 层继续', boss: true, c: PAL.gold };
    toast('楼心已停 · 塔还在长 · 向 76 层继续', PAL.gold);
    float(P.x, P.y - 30, '楼心 · 首通', PAL.gold);
    return;
  }

  S.bossDone[fl] = 'win';
  S.bossKills++;
  S.bossPenaltyT = 0; S.collapseMul = 1;
  S.score += 250 + fl * 4;
  if (S.collapseOn) S.collapseY += 4 * CFG.FH;
  /* 战利品喷泉：高额金币、经验晶簇与双回血球 */
  const totalCoins = Math.round((36 + fl * 0.6) * (S.richZone ? 1.6 : 1));
  for (let i = 0; i < 8; i++) {
    const v = i === 7 ? Math.max(2, totalCoins - 7 * Math.floor(totalCoins / 8)) : Math.max(2, Math.floor(totalCoins / 8));
    S.drops.push({ kind: 'coin', v, x: b.x, y: b.y, vx: (rng() - 0.5) * 190, vy: -150 - rng() * 110, t: 0, delay: 0.14 + rng() * 0.1 });
  }
  for (let i = 0; i < 4; i++) {
    S.drops.push({ kind: 'xp', v: 30, x: b.x, y: b.y, vx: (rng() - 0.5) * 150, vy: -130 - rng() * 90, t: 0, delay: 0.12 });
  }
  S.orbs.push({ x: b.x - 18, y: b.y - 6, t: 0 }, { x: b.x + 18, y: b.y - 6, t: 0 }, { x: b.x, y: b.y - 16, t: 0, shard: true });
  float(P.x, P.y - 28, meta.name + ' 讨伐成功 · 楼退 4 层！', PAL.gold);

  if (fl > 0 && fl % 10 === 0) {
    S.checkpoint = { floor: fl, x: Math.max(40, Math.min(CFG.W - 40, P.x)), y: floorY(fl) - CFG.platT };
    S.pendingGate = fl;
  }
  S.bossRewards = rollBossRewards();
  S.bossRewardOpen = true;
  clearGameplayInput();
}

function resolveBossTimeout() {
  if (!S.arena) return;
  const ar = S.arena, b = ar.boss, fl = ar.floor;
  const meta = BOSS_META[ar.bkind] || BOSS_META.colossus;
  if (b) {
    b.escaped = true; b.dead = true; b.flash = 0;
    burst(b.x, b.y, 28, PAL.violet);
    burst(b.x, b.y, 16, PAL.ink);
  }
  for (const o of S.monsters) if (!o.dead && o.kind !== 'dummy' && o.kind !== 'boss' && Math.abs(o.y - ar.botY) < 200) o.dead = true;
  S.arena = null; S.arenaHazards = []; S.boss = null;
  S.eshots = []; S.eblasts = [];
  sfx('bosstimeout'); sfx('bossopen');

  if (S.training) {
    toast('试炼超时：' + meta.name + ' 已破界遁走 · 按 B 重新挑战', PAL.red);
    return;
  }

  S.bossDone[fl] = 'timeout';
  if (ar.bkind === 'heart') { S.heartRule = null; S.dark = false; }
  /* 超时反噬：重创 -25 HP（保底留 1 HP 不直接秒杀）+ 无任何战利品 + 12 秒崩落狂暴追击 */
  const loss = Math.min(25, Math.max(0, Math.round(P.hp) - 1));
  hurtFeedback(loss, 'timeout', { minHp: 1, flash: 0.14, shake: 7, shakeT: 0.22, noFloat: true });
  P.iframe = 1.1;
  S.bossPenaltyT = 12; S.collapseMul = 1.25;
  if (S.collapseOn) {
    /* 超时保持崩落狂暴加速，但严禁瞬移至脚下 1.65 层导致 1HP 暴毙，保留至少 3.2 层奔跑容错 */
    S.collapseY = Math.max(P.y + 3.2 * CFG.FH, S.collapseY - 1.0 * CFG.FH);
  } else if (S.mode === 'limited') {
    S.timer = Math.max(5, S.timer - 8);
  }
  float(P.x, P.y - 26, '超时遁走 · 反噬 -' + loss, PAL.red);
  toast(meta.name + ' 超时遁走！未获悬赏 · 结界解封但楼体狂暴追击！', PAL.red);

  if (fl > 0 && fl % 10 === 0 && S.lastGate !== fl) {
    S.checkpoint = { floor: fl, x: Math.max(40, Math.min(CFG.W - 40, P.x)), y: floorY(fl) - CFG.platT };
    S.lastGate = fl;
    openGate(fl);
  }
}

function clampX(v, pad) { return Math.max(CFG.wallT + (pad || 24), Math.min(CFG.W - CFG.wallT - (pad || 24), v)); }

function updateBossAI(b, dt) {
  if (b.dormant || b.dead) return;
  const meta = BOSS_META[b.bkind] || BOSS_META.colossus;
  if (b.bkind === 'heart') {
    if (b.phase === 1 && b.hp <= b.max * 0.70) {
      b.phase = 2; b.btimer = 0.9; S.flash = 0.12; S.shake = 7; S.shakeT = 0.22; sfx('phase');
      const fl = b.floor || (S.arena && S.arena.floor) || (CFG.bossEvery * 5);
      const f = S.floors.get(fl);
      if (f) {
        const kinds = ['crawl', 'moth', 'raider'];
        for (let i = 0; i < 3; i++) {
          const add = kinds[(i + Math.floor(fl / (CFG.bossEvery * 5))) % kinds.length];
          const px0 = clampX(P.x + (i - 1) * 42, 26);
          const m = spawnMonster(add, px0, b.groundY - CFG.platT - (add === 'raider' ? 15 : 9), { x0: px0 - 34, x1: px0 + 34, dir: i % 2 ? -1 : 1, t: 0 });
          if (m) { m.bossAdd = true; m.cd = 0.5; }
        }
      }
      const rule = RULES[Math.floor(rng() * RULES.length)];
      S.heartRule = rule;
      S.dark = rule.id === 'dark';
      if (rule.id === 'fragile' && f) for (const pl of f.plats) if (pl.arenaWing && !pl.heartHigh) { pl.type = 'brit'; pl.steps = 1; }
      if (rule.id === 'rich') S.coins += 20;
      S.banner = { t: 3.8, floor: fl, text: '楼心 · 读你', mech: '心室规则「' + rule.text + '」· ' + rule.mech, boss: true, c: meta.c };
      toast('楼心二阶段：读你 · 3 只随影入场', PAL.gold);
    } else if (b.phase === 2 && b.hp <= b.max * 0.35) {
      b.phase = 3; b.btimer = 0.65; S.flash = 0.16; S.shake = 9; S.shakeT = 0.28; sfx('phase');
      const fl = b.floor || (S.arena && S.arena.floor) || (CFG.bossEvery * 5);
      const f = S.floors.get(fl);
      if (f) for (const p of f.plats) if (p.arenaWing && !p.heartHigh) p.gone = true;
      S.banner = { t: 3.8, floor: fl, text: '楼心 · 耐心见底', mech: '心室低台开始崩落 · 楼心攻速提升', boss: true, c: PAL.red };
      toast('楼心三阶段：耐心见底 · 低台崩落', PAL.red);
    }
  }
  if (b.hp <= b.max * 0.5 && b.phase === 1) {
    b.phase = 2;
    S.flash = 0.10; S.shake = Math.max(S.shake, 5); S.shakeT = 0.16; sfx('phase');
    burst(b.x, b.y, 20, meta.c);
    float(b.x, b.y - 36, '二阶段 · 凶威解放', PAL.red);
  }
  const fast = b.phase >= 3 ? 0.62 : (b.phase >= 2 ? 0.78 : 1);
  const bk = b.bkind || 'colossus';

  if (bk === 'colossus') {
    if (b.bstate === 'idle') {
      b.dir = P.x >= b.x ? 1 : -1;
      b.x = clampX(b.x + b.dir * (38 / fast) * dt, 30);
      b.y = b.groundY - 26;
      b.btimer -= dt;
      if (b.btimer <= 0 && !P.dead) {
        const sk = (b.skillIdx++) % 3;
        if (sk === 0) { b.bstate = 'quake_wind'; b.btimer = 0.44 * fast; sfx('enemylock'); }
        else if (sk === 1) { b.bstate = 'rock_wind'; b.btimer = 0.46 * fast; sfx('trapwarn'); }
        else { b.bstate = 'orb_wind'; b.btimer = 0.42 * fast; sfx('enemylock'); }
      }
    } else if (b.bstate === 'quake_wind') {
      b.btimer -= dt;
      if (b.btimer <= 0) {
        b.bstate = 'quake_leap';
        b.vy = -345;
        b.vx = Math.max(-135, Math.min(135, (P.x - b.x) * 1.15));
        sfx('jump');
      }
    } else if (b.bstate === 'quake_leap') {
      b.vy += 1080 * dt;
      b.x = clampX(b.x + b.vx * dt, 30);
      b.y += b.vy * dt;
      if (b.y >= b.groundY - 26) {
        b.y = b.groundY - 26; b.vy = 0; b.vx = 0;
        b.bstate = 'idle'; b.btimer = 1.15 * fast;
        S.shake = Math.max(S.shake, 7); S.shakeT = 0.20; sfx('slam');
        burst(b.x, b.groundY - 2, 18, PAL.gold);
        const wsp = 175 / fast;
        S.arenaHazards.push(
          { kind: 'wave', x: b.x - 16, y: b.groundY, vx: -wsp, w: 18, h: 18, dmg: 22, t: 2.2 },
          { kind: 'wave', x: b.x + 16, y: b.groundY, vx: wsp, w: 18, h: 18, dmg: 22, t: 2.2 }
        );
      }
    } else if (b.bstate === 'rock_wind') {
      b.btimer -= dt;
      if (b.btimer <= 0) {
        const cnt = b.phase >= 2 ? 5 : 4;
        const top0 = S.arena ? S.arena.topY + 14 : b.groundY - 156;
        for (let k = 0; k < cnt; k++) {
          const rx = k === 0 ? clampX(P.x, 18) : clampX(42 + (CFG.W - 84) * ((k - 0.5) / Math.max(1, cnt - 1)) + (rng() - 0.5) * 24, 18);
          S.arenaHazards.push({ kind: 'boulder', x: rx, y: top0, groundY: b.groundY, vy: 0, warn: 0.50 * fast + k * 0.08, dmg: 20, t: 3.4 });
        }
        S.shake = Math.max(S.shake, 4); S.shakeT = 0.12; sfx('rock');
        b.bstate = 'idle'; b.btimer = 1.25 * fast;
      }
    } else if (b.bstate === 'orb_wind') {
      b.btimer -= dt;
      if (b.btimer <= 0) {
        const base = Math.atan2(P.y - (b.y - 4), P.x - b.x);
        const cnt = b.phase >= 2 ? 7 : 5;
        const span = b.phase >= 2 ? 0.96 : 0.72;
        for (let k = 0; k < cnt; k++) {
          const a = base - span / 2 + span * (k / (cnt - 1));
          S.eshots.push({ kind: 'orb', x: b.x, y: b.y - 4, vx: Math.cos(a) * 165, vy: Math.sin(a) * 165, r: 5, dmg: 18, grav: 0, t: 2.6, slashable: true });
        }
        burst(b.x, b.y - 4, 8, PAL.gold); sfx('enemyshot');
        b.bstate = 'idle'; b.btimer = 1.10 * fast;
      }
    }
  } else if (bk === 'shura') {
    if (b.bstate === 'idle') {
      b.dir = P.x >= b.x ? 1 : -1;
      b.x = clampX(b.x + b.dir * (66 / fast) * dt, 24);
      b.y = b.groundY - 24;
      b.btimer -= dt;
      if (b.btimer <= 0 && !P.dead) {
        const sk = (b.skillIdx++) % 3;
        b.dir = P.x >= b.x ? 1 : -1;
        if (sk === 0) { b.bstate = 'iaido_wind'; b.btimer = 0.52 * fast; sfx('enemylock'); }
        else if (sk === 1) { b.bstate = 'crescent_fire'; b.subStep = b.phase >= 2 ? 3 : 2; b.btimer = 0.16; sfx('enemylock'); }
        else { b.bstate = 'dive_leap'; b.vy = -410; b.vx = Math.max(-220, Math.min(220, (P.x - b.x) * 2.1)); sfx('jump'); }
      }
    } else if (b.bstate === 'iaido_wind') {
      b.btimer -= dt;
      if (b.btimer > 0.22 && !P.dead) b.dir = P.x >= b.x ? 1 : -1;
      if (b.btimer <= 0) {
        b.bstate = 'iaido_dash'; b.btimer = 0.44; b.subStep = 0;
        burst(b.x, b.y + 8, 10, PAL.red); sfx('longswing');
      }
    } else if (b.bstate === 'iaido_dash') {
      b.btimer -= dt;
      b.subStep -= dt;
      b.x += b.dir * 520 * dt;
      if (S.frames % 2 === 0) S.parts.push({ x: b.x - b.dir * 10, y: b.y, vx: -b.dir * 30, vy: -14, t: 0.20, c: PAL.red, s: 3 });
      if (b.subStep <= 0) {
        b.subStep = 0.11;
        S.arenaHazards.push({ kind: 'slashbomb', x: b.x, y: b.groundY - 18, t: 0.34, r: 34, dmg: 22 });
      }
      const hitEdge = b.x <= CFG.wallT + 24 || b.x >= CFG.W - CFG.wallT - 24;
      b.x = clampX(b.x, 24);
      if (hitEdge || b.btimer <= 0) { b.bstate = 'idle'; b.btimer = 1.05 * fast; }
    } else if (b.bstate === 'crescent_fire') {
      b.btimer -= dt;
      if (b.btimer <= 0) {
        b.dir = P.x >= b.x ? 1 : -1;
        const wy = b.y - 4 + (b.subStep % 2 === 0 ? -8 : 4);
        const vyAim = Math.max(-95, Math.min(95, (P.y - wy) * 0.45));
        S.eshots.push({ kind: 'crescent', x: b.x + b.dir * 16, y: wy, vx: b.dir * 235, vy: vyAim, r: 9, dmg: 20, grav: 0, t: 2.2, slashable: true });
        burst(b.x + b.dir * 16, wy, 6, PAL.red); sfx('swing');
        b.subStep--;
        if (b.subStep <= 0) { b.bstate = 'idle'; b.btimer = 1.02 * fast; }
        else b.btimer = 0.24 * fast;
      }
    } else if (b.bstate === 'dive_leap') {
      b.vy += 980 * dt;
      b.x = clampX(b.x + b.vx * dt, 26);
      b.y += b.vy * dt;
      if (b.vy >= -20) { b.bstate = 'dive_slam'; b.vx = 0; b.vy = 560; sfx('dive'); }
    } else if (b.bstate === 'dive_slam') {
      b.y += b.vy * dt;
      if (b.y >= b.groundY - 24) {
        b.y = b.groundY - 24; b.vy = 0;
        S.shake = Math.max(S.shake, 6); S.shakeT = 0.18; sfx('slam');
        burst(b.x, b.groundY - 4, 18, PAL.red);
        const offs = b.phase >= 2 ? [-104, -52, 0, 52, 104] : [-56, 0, 56];
        for (const ox of offs) {
          const px0 = b.x + ox;
          if (px0 > CFG.wallT + 14 && px0 < CFG.W - CFG.wallT - 14) {
            S.arenaHazards.push({ kind: 'pillar', x: px0, y: b.groundY, warn: 0.36 * fast, activeT: 0.45, w: 22, h: 92, dmg: 22, t: 1.2 });
          }
        }
        b.bstate = 'idle'; b.btimer = 1.15 * fast;
      }
    }
  } else if (bk === 'lantern') {
    if (b.bstate === 'idle') {
      b.x += (b.x0 - b.x) * Math.min(1, dt * 4.5);
      b.y = b.y0 + Math.sin(b.t * 2.5) * 8;
      b.btimer -= dt;
      if (b.btimer <= 0 && !P.dead) {
        const anchors = [CFG.W * 0.22, CFG.W * 0.50, CFG.W * 0.78].filter(ax => Math.abs(ax - b.x0) > 36);
        burst(b.x, b.y, 10, PAL.cyan);
        b.x0 = anchors[Math.floor(rng() * anchors.length)] || CFG.W / 2;
        b.x = b.x0;
        burst(b.x, b.y, 12, PAL.violet);
        const sk = (b.skillIdx++) % 3;
        if (sk === 0) { b.bstate = 'spiral_cast'; b.subStep = 2; b.btimer = 0.36 * fast; sfx('orbcast'); }
        else if (sk === 1) { b.bstate = 'lance_cast'; b.btimer = 0.24; sfx('enemylock'); }
        else { b.bstate = 'summon_cast'; b.btimer = 0.40 * fast; sfx('orbcast'); }
      }
    } else if (b.bstate === 'spiral_cast') {
      b.y = b.y0 + Math.sin(b.t * 3.2) * 5;
      b.btimer -= dt;
      if (b.btimer <= 0) {
        const cnt = b.phase >= 2 ? 10 : 8;
        const rot = (b.subStep % 2) * (Math.PI / cnt);
        for (let k = 0; k < cnt; k++) {
          const a = rot + (k / cnt) * Math.PI * 2;
          S.eshots.push({ kind: 'orb', x: b.x, y: b.y - 4, vx: Math.cos(a) * 142, vy: Math.sin(a) * 142, r: 5, dmg: 18, grav: 0, t: 2.8, slashable: true });
        }
        burst(b.x, b.y - 4, 8, PAL.cyan); sfx('enemyshot');
        b.subStep--;
        if (b.subStep <= 0) { b.bstate = 'idle'; b.btimer = 1.20 * fast; }
        else b.btimer = 0.34 * fast;
      }
    } else if (b.bstate === 'lance_cast') {
      b.btimer -= dt;
      if (b.btimer <= 0) {
        const cnt = b.phase >= 2 ? 3 : 2;
        const top0 = S.arena ? S.arena.topY + 12 : b.groundY - 160;
        for (let k = 0; k < cnt; k++) {
          const sx0 = clampX(CFG.W * 0.18 + k * (cnt === 3 ? CFG.W * 0.30 : CFG.W * 0.64) + (rng() - 0.5) * 24, 16);
          const ang = Math.atan2((P.y + (k - 0.5) * 12) - top0, P.x - sx0);
          S.arenaHazards.push({
            kind: 'lance', x1: sx0, y1: top0,
            x2: sx0 + Math.cos(ang) * 260, y2: top0 + Math.sin(ang) * 260,
            warn: 0.54 * fast + k * 0.12, activeT: 0.26, dmg: 22, t: 1.4,
          });
        }
        b.bstate = 'idle'; b.btimer = 1.22 * fast;
      }
    } else if (b.bstate === 'summon_cast') {
      b.btimer -= dt;
      if (b.btimer <= 0) {
        const liveBombers = S.monsters.filter(o => !o.dead && o.kind === 'bomber').length;
        if (liveBombers < 2) {
          for (const sx0 of [b.x - 38, b.x + 38]) {
            const m = spawnMonster('bomber', clampX(sx0, 20), b.y - 12, { hp: 14, dmg: 22, cd: 0.35 });
            burst(m.x, m.y, 8, PAL.cyan);
          }
        } else {
          const base = Math.atan2(P.y - b.y, P.x - b.x);
          for (const oa of [-0.22, 0, 0.22]) {
            const a = base + oa;
            S.eshots.push({ kind: 'bolt', x: b.x, y: b.y, vx: Math.cos(a) * 290, vy: Math.sin(a) * 290, ang: a, r: 4, dmg: 20, grav: 0, t: 1.8, slashable: true });
          }
          sfx('enemyshot');
        }
        b.bstate = 'idle'; b.btimer = 1.18 * fast;
      }
    }
  } else if (bk === 'heart') {
    const top0 = S.arena ? S.arena.topY + 12 : b.groundY - 180;
    if (b.bstate === 'idle') {
      b.x = clampX(b.x0 + Math.sin(b.t * 1.25) * (CFG.W * 0.17), 64);
      b.y = b.y0 + Math.sin(b.t * 2.1) * 9;
      b.btimer -= dt;
      if (b.btimer <= 0 && !P.dead) {
        const sk = b.skillIdx++ % 4;
        if (sk === 0) { b.bstate = 'heart_wave'; b.btimer = 0.46 * fast; sfx('enemylock'); }
        else if (sk === 1) { b.bstate = 'heart_dash'; b.btimer = 0.36; b.vx = (P.x >= b.x ? 1 : -1) * 270; sfx('enemylock'); }
        else if (sk === 2) { b.bstate = 'heart_orbs'; b.btimer = 0.48 * fast; sfx('orbcast'); }
        else { b.bstate = 'heart_lance'; b.btimer = 0.56 * fast; sfx('trapwarn'); }
      }
    } else if (b.bstate === 'heart_wave') {
      b.btimer -= dt;
      if (b.btimer <= 0) {
        const wsp = 210 / fast;
        S.arenaHazards.push(
          { kind: 'wave', x: b.x - 18, y: b.groundY, vx: -wsp, w: 20, h: 20, dmg: 22, t: 2.2 },
          { kind: 'wave', x: b.x + 18, y: b.groundY, vx: wsp, w: 20, h: 20, dmg: 22, t: 2.2 }
        );
        S.shake = Math.max(S.shake, 5); S.shakeT = 0.16; sfx('slam');
        b.bstate = 'idle'; b.btimer = 1.15 * fast;
      }
    } else if (b.bstate === 'heart_dash') {
      b.btimer -= dt;
      b.x = clampX(b.x + b.vx * dt, 60);
      if (S.frames % 2 === 0) S.parts.push({ x: b.x - Math.sign(b.vx) * 20, y: b.y + 8, vx: -b.vx * 0.12, vy: -20, t: 0.22, c: PAL.red, s: 3 });
      if (b.btimer <= 0 || b.x <= CFG.wallT + 64 || b.x >= CFG.W - CFG.wallT - 64) {
        b.bstate = 'idle'; b.btimer = 1.0 * fast;
      }
    } else if (b.bstate === 'heart_orbs') {
      b.btimer -= dt;
      if (b.btimer <= 0) {
        const cnt = b.phase >= 3 ? 16 : 12;
        for (let k = 0; k < cnt; k++) {
          const a = (k / cnt) * Math.PI * 2 + b.t * 0.2;
          S.eshots.push({ kind: 'orb', x: b.x, y: b.y + 4, vx: Math.cos(a) * 150, vy: Math.sin(a) * 150, r: 5, dmg: 18, grav: 0, t: 3.0, slashable: true });
        }
        burst(b.x, b.y, 10, PAL.red); sfx('enemyshot');
        b.bstate = 'idle'; b.btimer = 1.15 * fast;
      }
    } else if (b.bstate === 'heart_lance') {
      b.btimer -= dt;
      if (b.btimer <= 0) {
        for (let k = 0; k < 3; k++) {
          const sx0 = clampX(P.x + (k - 1) * 90, 26);
          const ang = Math.atan2(P.y - top0, P.x - sx0);
          S.arenaHazards.push({
            kind: 'lance', x1: sx0, y1: top0,
            x2: sx0 + Math.cos(ang) * 280, y2: top0 + Math.sin(ang) * 280,
            warn: 0.54 * fast + k * 0.08, activeT: 0.26, dmg: 22, t: 1.5,
          });
        }
        sfx('bosslaser');
        b.bstate = 'idle'; b.btimer = 1.2 * fast;
      }
    }
  } else {
    /* ocular：千机魔眼·天枢 */
    if (b.bstate === 'idle') {
      b.x = CFG.W / 2 + Math.sin(b.t * 1.15) * (CFG.W * 0.20);
      b.y = b.y0 + Math.cos(b.t * 2.1) * 6;
      if (!P.dead) b.aimAng = Math.atan2(P.y - b.y, P.x - b.x);
      b.btimer -= dt;
      if (b.btimer <= 0 && !P.dead) {
        const sk = (b.skillIdx++) % 3;
        if (sk === 0) {
          const leftFirst = P.x < b.x;
          b.laserStart = leftFirst ? Math.PI * 0.79 : Math.PI * 0.21;
          b.laserEnd = leftFirst ? Math.PI * 0.21 : Math.PI * 0.79;
          b.aimAng = b.laserStart;
          b.laserDur = 1.22 * fast;
          b.bstate = 'laser_wind'; b.btimer = 0.62 * fast;
          sfx('enemylock');
        } else if (sk === 1) {
          b.bstate = 'barrage_fire'; b.subStep = b.phase >= 2 ? 4 : 3; b.btimer = 0.16;
          sfx('enemylock');
        } else {
          b.bstate = 'carpet_drop'; b.btimer = 0.36 * fast;
          sfx('trapwarn');
        }
      }
    } else if (b.bstate === 'laser_wind') {
      b.btimer -= dt;
      b.aimAng = b.laserStart;
      if (b.btimer <= 0) {
        b.bstate = 'laser_fire'; b.btimer = b.laserDur;
        S.shake = Math.max(S.shake, 4); S.shakeT = 0.24; sfx('bosslaser');
      }
    } else if (b.bstate === 'laser_fire') {
      b.btimer -= dt;
      const u = 1 - Math.max(0, b.btimer / (b.laserDur || 1.1));
      b.aimAng = b.laserStart + (b.laserEnd - b.laserStart) * u;
      const lx2 = b.x + Math.cos(b.aimAng) * 280, ly2 = b.y + Math.sin(b.aimAng) * 280;
      if (S.frames % 2 === 0) {
        const hitY = Math.min(b.groundY, ly2);
        const ratio = Math.abs(ly2 - b.y) > 1 ? (hitY - b.y) / (ly2 - b.y) : 1;
        const hx = b.x + (lx2 - b.x) * Math.max(0, Math.min(1, ratio));
        S.parts.push({ x: hx, y: hitY - 2, vx: (rng() - 0.5) * 60, vy: -40 - rng() * 50, t: 0.22, c: rng() < 0.5 ? PAL.red : PAL.gold, s: 2 });
      }
      if (!P.dead && segDist(P.x, P.y, b.x, b.y, lx2, ly2) < 13) {
        damagePlayer(24, (P.x >= b.x ? 1 : -1) * 165, -185, 'shot', (BOSS_META[b.bkind] || BOSS_META.ocular).name + '裁决光束');
      }
      if (b.btimer <= 0) { b.bstate = 'idle'; b.btimer = 1.18 * fast; }
    } else if (b.bstate === 'barrage_fire') {
      b.btimer -= dt;
      if (!P.dead) b.aimAng = Math.atan2(P.y - b.y, P.x - b.x);
      if (b.btimer <= 0) {
        const side = b.subStep % 2 === 0 ? -1 : 1;
        const ox = b.x + side * 26, oy = b.y + 4;
        const a = Math.atan2(P.y - oy, P.x - ox);
        S.eshots.push({ kind: 'bolt', x: ox, y: oy, vx: Math.cos(a) * 310, vy: Math.sin(a) * 310, ang: a, r: 4, dmg: 20, grav: 0, t: 1.8, slashable: true });
        burst(ox, oy, 5, PAL.gold); sfx('enemyshot');
        b.subStep--;
        if (b.subStep <= 0) { b.bstate = 'idle'; b.btimer = 1.05 * fast; }
        else b.btimer = 0.20 * fast;
      }
    } else if (b.bstate === 'carpet_drop') {
      b.btimer -= dt;
      if (b.btimer <= 0) {
        const cnt = b.phase >= 2 ? 5 : 4;
        for (let k = 0; k < cnt; k++) {
          const tx = 52 + (CFG.W - 104) * (k / (cnt - 1));
          const vx = (tx - b.x) * 1.35;
          S.eshots.push({ kind: 'bomb', x: b.x + (k - 1.5) * 8, y: b.y + 10, vx: Math.max(-210, Math.min(210, vx)), vy: -140 - (k % 2) * 35, r: 6, dmg: 20, blastR: 38, grav: 540, t: 2.8, slashable: true });
        }
        sfx('enemyshot');
        b.bstate = 'idle'; b.btimer = 1.18 * fast;
      }
    }
  }

  /* 取消静态本体触碰扣血：仅在 Boss 发动泰山压顶重砸或高速居合突刺/俯冲下劈等主动冲撞动作时判定伤害 */
  if (!P.dead) {
    const colSlam = bk === 'colossus' && b.bstate === 'quake_leap' && b.vy > 40 && Math.abs(b.x - P.x) < 30 && Math.abs(b.y - P.y) < 32;
    const shuraDash = bk === 'shura' && b.bstate === 'iaido_dash' && Math.abs(b.x - P.x) < 28 && Math.abs(b.y - P.y) < 28;
    const shuraDive = bk === 'shura' && b.bstate === 'dive_slam' && Math.abs(b.x - P.x) < 24 && Math.abs(b.y - P.y) < 30;
    const heartDash = bk === 'heart' && b.bstate === 'heart_dash' && Math.abs(b.x - P.x) < 50 && Math.abs(b.y - P.y) < 54;
    if (colSlam || shuraDash || shuraDive || heartDash) {
      const kdir = shuraDash ? b.dir : (P.x >= b.x ? 1 : -1);
      damagePlayer(b.dmg, kdir * 180, -215, 'dash', (BOSS_META[b.bkind] || BOSS_META.colossus).name + '冲撞');
    }
  }
}

function updateArenaHazards(dt) {
  for (const h of S.arenaHazards) {
    if (h.kind === 'wave') {
      h.x += h.vx * dt; h.t -= dt;
      if (h.x < CFG.wallT + 6 || h.x > CFG.W - CFG.wallT - 6) { h.t = 0; burst(h.x, h.y - 6, 6, PAL.gold); continue; }
      if (S.frames % 3 === 0) S.parts.push({ x: h.x, y: h.y - 4, vx: -h.vx * 0.2, vy: -30 - rng() * 25, t: 0.22, c: PAL.gold, s: 2 });
      if (trapHitPlayer(h.x - h.w / 2, h.y - h.h, h.x + h.w / 2, h.y + 2)) {
        damagePlayer(h.dmg, Math.sign(h.vx) * 165, -230, 'shot', '玄岳裂地波');
      }
    } else if (h.kind === 'boulder') {
      h.t -= dt;
      if (h.warn > 0) {
        h.warn -= dt;
        if (S.frames % 4 === 0) S.parts.push({ x: h.x + (rng() - 0.5) * 10, y: h.y, vx: 0, vy: 28, t: 0.24, c: PAL.gold, s: 2 });
      } else {
        h.vy += 1350 * dt; h.y += h.vy * dt;
        if (trapHitPlayer(h.x - 9, h.y - 9, h.x + 9, h.y + 9)) {
          damagePlayer(h.dmg, (P.x >= h.x ? 1 : -1) * 140, -180, 'trap', '巨岩');
          h.t = 0; burst(h.x, h.y, 10, PAL.stone3); continue;
        }
        if (h.y + 8 >= h.groundY) {
          h.t = 0; burst(h.x, h.groundY - 4, 10, PAL.stone2); sfx('rock');
        }
      }
    } else if (h.kind === 'slashbomb') {
      h.t -= dt;
      if (h.t <= 0) enemyExplode(h.x, h.y, h.r || 34, h.dmg || 22, true, '修罗爆裂');
    } else if (h.kind === 'pillar') {
      if (h.warn > 0) {
        h.warn -= dt;
        if (h.warn <= 0) sfx('flame');
      } else {
        h.activeT -= dt;
        if (h.activeT <= 0) { h.t = 0; continue; }
        if (S.frames % 2 === 0) S.parts.push({ x: h.x + (rng() - 0.5) * 14, y: h.y - rng() * h.h, vx: (rng() - 0.5) * 20, vy: -60 - rng() * 40, t: 0.24, c: rng() < 0.5 ? PAL.red : PAL.gold, s: 2 });
        if (trapHitPlayer(h.x - h.w / 2, h.y - h.h, h.x + h.w / 2, h.y)) {
          damagePlayer(h.dmg, (P.x >= h.x ? 1 : -1) * 165, -240, 'shot', '火柱');
        }
      }
    } else if (h.kind === 'lance') {
      if (h.warn > 0) {
        h.warn -= dt;
        if (h.warn <= 0) sfx('enemyshot');
      } else {
        h.activeT -= dt;
        if (h.activeT <= 0) { h.t = 0; continue; }
        if (!P.dead && segDist(P.x, P.y, h.x1, h.y1, h.x2, h.y2) < 11) {
          damagePlayer(h.dmg, (P.x >= (h.x1 + h.x2) / 2 ? 1 : -1) * 160, -200, 'shot', '光枪');
        }
      }
    }
  }
  S.arenaHazards = S.arenaHazards.filter(h => h.t > 0);
}

/* ---------- 主更新 ---------- */
function update(dt) {
  if (S.screen !== 'playing') { S.banner && (S.banner.t -= dt); return; }
  if (S.paused) return;
  if (S.shopOpen || S.bossRewardOpen || S.panel || S.helpOpen || S.settingsOpen || S.guideOpen || S.loadout || (S.training && S.trainToolsOpen)) {
    clearGameplayInput();
    // 全屏面板遮住通知时保留寿命，关闭后继续阅读。
    if (S.banner) { S.banner.t -= dt; if (S.banner.t <= 0) S.banner = null; }
    return;
  }
  if (S.hitstop > 0) { S.hitstop -= dt; return; }
  S.t += dt; S.frames++;
  if (S.training && S.trainingStats) S.trainingStats.time += dt;
  if (S.shakeT > 0) S.shakeT -= dt; else S.shake = 0;
  if (S.flash > 0) S.flash -= dt;
  if (S.comboT > 0) { S.comboT -= dt; if (S.comboT <= 0) S.combo = 0; }
  if (S.banner) { S.banner.t -= dt; if (S.banner.t <= 0) S.banner = null; }
  tickToasts(dt);
  if (S.bossPenaltyT > 0) {
    S.bossPenaltyT -= dt;
    if (S.bossPenaltyT <= 0) { S.bossPenaltyT = 0; S.collapseMul = 1; }
  }
  if (S.collapseHoldT > 0) S.collapseHoldT = Math.max(0, S.collapseHoldT - dt);
  if (!S.hall && S.mode === 'limited' && !(S.arena && S.arena.active)) {
    S.timer -= dt; if (S.timer <= 0) { endRun('time'); return; }
  }

  if (P.dead) {
    S.deathT += dt;
    updateAnim(dt);
    if (S.deathT >= 0.5) {
      if (S.deadPending === 'revive') { S.reviveUsed = true; S.deadPending = null; respawn(); toast('印记复活', PAL.gold); }
      else endRun(S.lastDeath);
    }
    return;
  }
  readInput();
  /* 首局分阶段教学：记录移动输入，推进阶段，听情境提示 */
  if (!S.hall && S.tut && S.tut.on && IN.ax !== 0) S.tut.moved = true;
  if (!S.hall) { tutTick(dt); tutorialFollowUps(dt); }
  if (IN.slotSwap) { P.slot = 1 - P.slot; P.drawWeapT = 0.18; P.sheatheT = 0; P.atkBuf = 0; IN.slotSwap = false; weaponHint(P.slot); }
  if (!S.training && !S.hall) ensureFloors(Math.max(0, Math.floor(-P.y / CFG.FH) + 6));
  if (!S.hall) { ensurePactNear(); pactTick(dt); }
  if (P.furyT > 0) P.furyT = Math.max(0, P.furyT - dt);
  if (!S.training && !S.hall) {
    const f = Math.max(0, Math.floor(-P.y / CFG.FH));
    while (S.lastFloorSeen < f) {
      S.lastFloorSeen++;
      const n = S.lastFloorSeen;
      S.score += 10; sfx('floor');
      if (n % 5 === 0 && n % 10 !== 0 && !isBossFloor(n)) { S.coins += 5; toast('第 ' + n + ' 层 +5 金', PAL.gold); }
      if (n % 10 === 0) {
        S.coins += 10; S.score += 50;
        if (!isBossFloor(n)) S.chests.push({ x: CFG.W / 2, y: floorY(n) - CFG.platT - 10, floor: n, opened: false, t: 0 });
        toast(isBossFloor(n) ? regionTheme(n).name + ' · 镇楼门界 +10 金 · 准备迎敌！' : regionTheme(n).name + ' · 区域门 +10 金 · 宝箱', PAL.gold); sfx('milestone');
      }
      /* 新手资助：真正首局首次攀上第 1 层一次性发放，与纪录奖励彻底分离（meta 持久，仅一次） */
      if (n === 1 && !S.meta.noviceGrant) { S.meta.noviceGrant = true; S.coins += 20; saveMeta(); toast('新手资助 +20 金 · 仅此一次', PAL.gold); }
      if (n > S.bestThisRun) {
        S.bestThisRun = n;
        /* 刷新历史最佳只给荣誉提示，不再直接发钱，避免刚离地刷纪录就获大额收益 */
        if (n > S.meta.best && !S.newBestBonus) { S.newBestBonus = true; toast('刷新纪录 · 第 ' + n + ' 层', PAL.violet); sfx('record'); }
        /* 长期纪录奖励按里程碑发放：每首次跨过整十层给 +20 金，逐档持久化，高纪录玩家也要真攀到新档才有 */
        const tier = Math.floor(n / 10) * 10, oldTier = S.meta.recordTier || 0;
        if (tier >= 10 && tier > oldTier) {
          const gain = (tier - oldTier) / 10 * 20;
          S.meta.recordTier = tier; S.coins += gain; saveMeta();
          toast('攀登里程碑 第 ' + tier + ' 层 +' + gain + ' 金', PAL.gold); sfx('milestone');
        }
      }
    }
  }
  /* 区域规则到期回收，防止 fast/dark/rich 永久生效 */
  if (!S.hall && S.zone && Math.floor(-P.y / CFG.FH) > S.zone.to) {
    S.zone = null; S.rule = null; S.ruleMul = 1; S.dark = false; S.richZone = false;
    toast('这一段过去了，规则失效', PAL.mut);
  }

  /* 首局教学期间暂停崩落（最多 60s，卡关也不会永久堵住）；教学结束 3.5s 后再开始追 */
  const tutHoldCollapse = S.tut && S.tut.on && S.tut.t < 60;
  if (!S.hall && !S.training && !tutHoldCollapse && !(S.collapseHoldT > 0) && !(S.pact && S.pact.state === 'fight') && !S.collapseOn && S.mode !== 'limited' && S.t > CFG.collapseDelay) { S.collapseOn = true; S.collapseY = P.y + 160; sfx('collapse'); }
  if (S.freezeT > 0) S.freezeT -= dt;
  if (S.collapseOn) {
    if (S.arena && S.arena.active && !S.training) {
      S.collapseY = Math.max(S.collapseY, floorY(S.arena.floor) + 1.8 * CFG.FH);
    } else {
      S.collapseY -= CFG.collapseSpeed * S.collapseMul * S.ruleMul * difficultyNow().collapse * (S.freezeT > 0 ? 0 : 1) * (S.pact && S.pact.state === 'fight' ? 0 : 1) * dt;
    }
    /* 冰符：前线逼近 1 层内自动冻结 4s 并消耗 */
    if (P.runes.includes('ice') && (P.y + P.h / 2 + 96) > S.collapseY) {
      S.freezeT = 4; P.runes = P.runes.filter(r => r !== 'ice');
      float(P.x, P.y - 22, '冻结 4s', PAL.cyan); S.flash = 0.08;
    }
    S.embers += dt * 20;
    if (S.collapseY - (P.y + P.h / 2) < 2 * CFG.FH) sfx('warn');
    while (S.embers >= 1) { S.embers--; S.parts.push({ x: rng() * CFG.W, y: S.collapseY - rng() * 30, vx: (rng() - 0.5) * 40, vy: -60 - rng() * 80, t: 0.6, c: rng() < 0.5 ? PAL.red : PAL.gold, s: 2 }); }
  }

  if (P.landT > 0) P.landT = Math.max(0, P.landT - dt);
  if (P.skidT > 0) P.skidT = Math.max(0, P.skidT - dt);
  if (P.hurtT > 0) P.hurtT = Math.max(0, P.hurtT - dt);
  if (P.sheatheT > 0) P.sheatheT = Math.max(0, P.sheatheT - dt);
  if (P.drawWeapT > 0) P.drawWeapT = Math.max(0, P.drawWeapT - dt);
  if (P.slamming) P.slamT = (P.slamT || 0) + dt; else P.slamT = 0;
  if (P.slamLandT > 0) {
    const prevSl = P.slamLandT;
    P.slamLandT = Math.max(0, P.slamLandT - dt);
    if (prevSl > 0 && P.slamLandT <= 0 && P.weapon.melee === 'hammer') P.sheatheT = 0.14;
  }
  const relax = Math.min(1, dt * 14);
  P.sx += (1 - P.sx) * relax;
  P.sy += (1 - P.sy) * relax;

  const gp = P.onGround ? P.groundPlat : null;
  const onIce = !!(gp && gp.type === 'ice');
  const acc = P.onGround ? (onIce ? 320 : CFG.accG) : CFG.accA;
  if (P.dodgeCd > 0) P.dodgeCd -= dt;
  if (P.dodgeT > 0) {
    P.dodgeT -= dt;
    P.vx = P.dodgeDir * CFG.dodge.speed;
    if (P.vy > 40) P.vy = 40;
    if (S.frames % 2 === 0) S.trails.push({ kind: 'dash', x: P.x, y: P.y, face: P.dodgeDir, t: 0.16, life: 0.16 });
  } else {
    const lowHp = P.hp <= CFG.hpMax * 0.3;
    const maxSpd = lowHp ? 95 : CFG.runMax;
    const target = IN.ax * maxSpd * P.spdMul;
    if (P.onGround && Math.abs(P.vx) > 125 && (IN.ax === 0 || IN.ax * P.vx < 0)) {
      P.skidT = 0.11;
      if (S.frames % 4 === 0) S.parts.push({ x: P.x + Math.sign(P.vx) * 6, y: P.y + 14, vx: Math.sign(P.vx) * 28, vy: -18 - rng() * 16, t: 0.22, c: onIce ? PAL.cyan : PAL.stone2, s: 2 });
    }
    if (P.vx < target) P.vx = Math.min(target, P.vx + acc * dt);
    else if (P.vx > target) P.vx = Math.max(target, P.vx - acc * dt);
  }
  if (IN.ax !== 0 && P.onGround) P.face = IN.ax > 0 ? 1 : -1;

  P.vy += CFG.G * dt;
  P.wall = 0; P.climbing = false;
  const wL = P.x - P.w / 2 <= CFG.wallT + 2 ? wallAt('L', P.y) : null;
  const wR = P.x + P.w / 2 >= CFG.W - CFG.wallT - 2 ? wallAt('R', P.y) : null;
  const hitSpikeL = wL && wL.spikeWall && (P.onGround ? IN.ax < 0 : IN.ax <= 0);
  const hitSpikeR = wR && wR.spikeWall && (P.onGround ? IN.ax > 0 : IN.ax >= 0);
  if (hitSpikeL || hitSpikeR) {
    if (damagePlayer(TRAP_META.spikewall.dmg, (hitSpikeL ? 1 : -1) * 190, -210, 'trap', TRAP_META.spikewall.name)) P.onGround = false;
    P.wall = 0; P.grabT = 0;
  } else if (!P.onGround) {
    if (wL && IN.ax < 0) P.wall = -1;
    else if (wR && IN.ax > 0) P.wall = 1;
    if (P.wall !== 0) {
      P.grabT += dt; P.jumps = 1;
      if (P.runes.includes('climb') && P.grabT > CFG.grabToClimb && IN.ax !== 0) { P.climbing = true; P.vy = -CFG.climbV; }
      else if (P.vy > 0) {
        P.vy = Math.min(P.vy, CFG.wallSlideMax);
        if (P.vy > 30 && S.frames % 6 === 0) S.parts.push({ x: P.x + P.wall * 7, y: P.y - 2 + (rng() - 0.5) * 10, vx: -P.wall * (12 + rng() * 14), vy: -18 - rng() * 15, t: 0.24, c: PAL.stone2, s: 2 });
      }
    } else P.grabT = 0;
  } else P.grabT = 0;

  if (IN.jump) { P.buf = CFG.buffer; IN.jump = false; }
  if (P.buf > 0) P.buf -= dt;
  if (P.onGround) { P.coyote = CFG.coyote; P.jumps = 0; P.cut = false; }
  else if (P.coyote > 0) P.coyote -= dt;
  if (P.buf > 0) {
    if (P.onGround || P.coyote > 0) {
      P.vy = CFG.jumpV; P.onGround = false; P.coyote = 0; P.buf = 0; P.cut = false;
      P.sx = 0.86; P.sy = 1.16; P.landT = 0; P.slamLandT = 0;
      if (S.tut) S.tut.jumped = true;
      burst(P.x, P.y + 10, 4, PAL.mut); sfx('jump');
    } else if (P.wall !== 0) {
      const wSide = P.wall;
      P.vy = CFG.wallJumpY; P.vx = -wSide * CFG.wallJumpX; P.face = -wSide; P.buf = 0; P.grabT = 0; P.cut = false;
      P.sx = 0.85; P.sy = 1.16;
      if (S.tut) S.tut.jumped = true;
      S.trails.push({ kind: 'airring', x: P.x + wSide * 6, y: P.y + 4, t: 0.20, life: 0.20, c: PAL.hi, vert: true });
      burst(P.x + wSide * 7, P.y + 4, 5, PAL.hi); sfx('wall');
    } else if (P.jumps < 2) {
      P.vy = CFG.djV; P.jumps = 2; P.buf = 0; P.cut = false;
      P.sx = 0.84; P.sy = 1.18;
      if (S.tut) { S.tut.dj = true; S.tut.jumped = true; }
      S.trails.push({ kind: 'airring', x: P.x, y: P.y + 13, t: 0.22, life: 0.22, c: PAL.cyan });
      burst(P.x, P.y + 8, 6, PAL.cyan); sfx('djump');
    } else if (P.airBonus > 0) {
      P.vy = CFG.djV * 0.92; P.airBonus--; P.buf = 0; P.cut = false;
      P.sx = 0.84; P.sy = 1.18;
      S.trails.push({ kind: 'airring', x: P.x, y: P.y + 13, t: 0.24, life: 0.24, c: PAL.green });
      burst(P.x, P.y + 8, 8, PAL.green); float(P.x, P.y - 20, '羽', PAL.green);
    }
  }
  if (!IN.jumpHeld && P.vy < 0 && !P.cut) { P.vy *= CFG.jumpCut; P.cut = true; }

  if (IN.slam) { doSlam(); IN.slam = false; }
  if (IN.atk || S.autoAttack) { doAttack(); IN.atk = false; }
  if (P.atkCd > 0) P.atkCd -= dt;
  /* 近战输入缓冲兑现：冷却结束立刻兑现排队的一击 */
  if (P.atkBuf > 0) {
    P.atkBuf -= dt;
    if (P.atkCd <= 0) { P.atkBuf = 0; doAttack(); }
  }
  /* 长按攻击：远程槽持续发射，冷却好就出一发；近战仍保持单次按键节奏 */
  if (IN.atkHeld && P.slot === 1 && P.atkCd <= 0) doAttack();
  if (P.atkPending) {
    P.atkPending.t -= dt;
    if (P.atkPending.t <= 0) { executeStrike(P.atkPending); P.atkPending = null; }
  }
  if (P.anim.atk > 0 && WEAP[P.anim.atkW] && WEAP[P.anim.atkW].slot === 'melee' && P.anim.atk < P.anim.atkDur * 0.78 && P.anim.atk > P.anim.atkDur * 0.16) {
    slashEnemyShots(WEAP[P.anim.atkW]);
  }

  P.x += P.vx * dt;
  P.x = Math.max(CFG.wallT + P.w / 2, Math.min(CFG.W - CFG.wallT - P.w / 2, P.x));
  const prevY = P.y;
  P.y += P.vy * dt;
  P.onGround = false; P.groundPlat = null;
  if (P.vy >= 0) {
    for (const p of platsNear()) {
      if (P.x + P.w / 2 < p.x || P.x - P.w / 2 > p.x + p.w) continue;
      const top = p.y - CFG.platT;
      if (prevY + P.h / 2 <= top + 1 && P.y + P.h / 2 >= top) {
        if (p.type === 'brit') { p.steps--; if (p.steps <= 0) { p.gone = true; burst(p.x + p.w / 2, p.y, 8, PAL.stone); continue; } }
        const landVy = P.vy, wasSlam = P.slamming;
        if (landVy > 420 && !wasSlam) sfx('land', { pan: (P.x / CFG.W) * 2 - 1 });
        P.y = top - P.h / 2; P.onGround = true; P.groundPlat = p; P.airDodge = false;
        if (p.blue && !p.blueHit) { p.blueHit = true; hurtFeedback(15, 'blue', { srcTag: '蓝', color: PAL.cyan, hurtT: 0.22 }); if (!S.training && P.hp <= 0) die('blue'); }
        if (P.runes.includes('feather') && P.lastFloor !== p.floor) { P.lastFloor = p.floor; P.airBonus = 1; }
        if (wasSlam) slamImpact();
        if (p.type === 'bounce' && landVy > 120) {
          P.vy = -700; P.onGround = false; P.sx = 0.80; P.sy = 1.22; P.landT = 0;
          S.trails.push({ kind: 'airring', x: P.x, y: P.y + 13, t: 0.24, life: 0.24, c: PAL.green });
          burst(P.x, P.y + 10, 6, PAL.green);
        } else {
          P.vy = 0;
          if (!wasSlam && landVy > 165) {
            const k = Math.min(1, (landVy - 165) / 460);
            P.landT = 0.09 + 0.07 * k;
            P.sx = 1 + 0.16 * k;
            P.sy = 1 - 0.15 * k;
            if (landVy > 280) {
              const cnt = landVy > 460 ? 3 : 2;
              for (let di = 0; di < cnt; di++) {
                S.parts.push({ x: P.x - 4 - di * 2, y: P.y + 14, vx: -32 - rng() * 36, vy: -14 - rng() * 20, t: 0.26, c: PAL.stone2, s: 2 });
                S.parts.push({ x: P.x + 4 + di * 2, y: P.y + 14, vx: 32 + rng() * 36, vy: -14 - rng() * 20, t: 0.26, c: PAL.stone2, s: 2 });
              }
            }
          }
        }
        if (p.type === 'gate' && S.checkpoint.floor !== p.floor) {
          S.checkpoint = { floor: p.floor, x: Math.max(40, Math.min(CFG.W - 40, P.x)), y: p.y - CFG.platT };
          S.flash = 0.1; burst(P.x, P.y, 10, PAL.gold);
          if (S.lastGate !== p.floor) { S.lastGate = p.floor; openGate(p.floor); }
        }
        break;
      }
    }
  }
  if (P.onGround && P.groundPlat && P.groundPlat.type === 'belt' && P.dodgeT <= 0) {
    const bDir = P.groundPlat.beltDir || 1;
    P.x = Math.max(CFG.wallT + P.w / 2, Math.min(CFG.W - CFG.wallT - P.w / 2, P.x + bDir * 78 * dt));
  }
  if (P.onGround && Math.abs(P.vx) > 130 && S.frames % 2 === 0) S.trails.push({ kind: 'ghost', x: P.x, y: P.y, face: P.face, t: 0.18, life: 0.18 });
  if (P.onGround && Math.abs(P.vx) > 150 && S.frames % 5 === 0) {
    S.parts.push({ x: P.x - Math.sign(P.vx) * 8, y: P.y + 14, vx: -Math.sign(P.vx) * 40, vy: -24, t: 0.28, c: PAL.stone2, s: 2 });
  }
  if (P.slamming) S.trails.push({ kind: 'ghost', x: P.x, y: P.y, face: P.face, t: 0.15, life: 0.15 });

  /* 踏入 50F 倍数 Boss 祭坛层：触发上下结界封锁与限时悬赏讨伐 */
  if (!S.training && !S.arena && !P.dead) {
    for (const m of S.monsters) {
      if (m.kind === 'boss' && !m.dead && m.dormant && !S.bossDone[m.floor]) {
        const botY = floorY(m.floor) - CFG.platT;
        if (P.y + P.h / 2 <= botY + 3 && P.y >= botY - 145) {
          startBossArena(m.floor, m);
          break;
        }
      }
    }
  }
  /* 结界上下双向刚体封锁 + 讨伐倒计时演算 */
  if (S.arena && S.arena.active) {
    const ceilY = S.arena.topY + 8;
    if (P.y - P.h / 2 < ceilY) {
      P.y = ceilY + P.h / 2;
      if (P.vy < 45) P.vy = 45;
      P.climbing = false;
    }
    const flrY = S.arena.botY;
    if (P.y + P.h / 2 > flrY) {
      P.y = flrY - P.h / 2;
      if (P.vy > 0) P.vy = 0;
      P.onGround = true; P.airDodge = false;
    }
    S.arena.timeLeft -= dt;
    if (S.arena.timeLeft <= 8 && S.arena.timeLeft > 0) {
      const secInt = Math.ceil(S.arena.timeLeft);
      if (secInt < S.arena.tickSec) {
        S.arena.tickSec = secInt;
        sfx('bosstick');
      }
    }
    if (S.arena.timeLeft <= 0) {
      resolveBossTimeout();
    }
  }

  for (const p of platsNear()) {
    p.warn = S.collapseOn && p.y >= S.collapseY - CFG.warnAhead && p.y < S.collapseY;
    if (S.collapseOn && p.y >= S.collapseY && !p.gone) { p.gone = true; burst(p.x + p.w / 2, p.y, 12, PAL.stone2); }
  }
  if (S.collapseOn && !(S.arena && S.arena.active) && P.y + P.h / 2 >= S.collapseY) die('collapse');

  if (!S.hall) { updateTraps(dt); updateArenaHazards(dt); }

  for (const m of S.monsters) {
    if (m.flash > 0) m.flash -= dt;
    if (m.trapCd > 0) m.trapCd -= dt;
    if (m.dead) {
      /* 死亡飞尸：击飞/击退后仍继续飞行到 kbT 结束 */
      if (m.kbT > 0) {
        m.kbT -= dt;
        m.x += m.kbVx * dt;
        m.y += m.kbVy * dt;
        m.kbVy += m.kbG * dt;
        m.x = Math.max(24, Math.min(CFG.W - 24, m.x));
      }
      continue;
    }
    m.t += dt;
    if (m.kind === 'dummy') { if (m.hitT > 0) m.hitT -= dt; continue; }
    if (m.kind === 'turret') {
      /* 壁挂弩机：固定在侧墙、可被玩家攻击破坏、蓄力发射水平弩箭（可被近战斩落） */
      if (m.charge > 0) {
        m.charge -= dt;
        if (m.charge <= 0 && !P.dead) {
          m.charge = 0; m.state = 'idle'; m.cd = 1.85 + rng() * 0.45;
          const sp = 240, d = m.dir || 1;
          S.eshots.push({ kind: 'arrow', x: m.x + d * 9, y: m.y, vx: d * sp, vy: 0, r: 4, dmg: m.dmg, grav: 0, t: 1.8, slashable: true });
          burst(m.x + d * 9, m.y, 4, PAL.gold); sfx('enemyshot');
        }
      } else {
        m.cd = (m.cd === undefined ? 1.1 : m.cd) - dt;
        const d = m.dir || 1;
        if (m.cd <= 0 && !P.dead && Math.abs(P.y - m.y) < 46 && (P.x - m.x) * d > 0 && Math.abs(P.x - m.x) < 290) {
          m.charge = 0.36; m.state = 'charge';
          if (trapNear(m.y)) sfx('trapwarn');
        }
      }
      continue;
    }
    if (m.kbT > 0) {
      m.kbT -= dt;
      m.x += m.kbVx * dt;
      m.y += m.kbVy * dt;
      m.kbVy += m.kbG * dt;
      m.x = Math.max(28, Math.min(CFG.W - 28, m.x));
      if (m.kind === 'crawl' || m.kind === 'raider' || m.kind === 'grenadier') m.x = Math.max(m.x0, Math.min(m.x1, m.x));
      if (m.kbT <= 0) {
        m.kbT = 0;
        if (m.kind === 'crawl' || m.kind === 'raider' || m.kind === 'grenadier') m.y = m.y0;
        else { m.x0 = m.x; m.y0 = m.y; m.calm = 0; m.chase = 0; }
      }
      continue;
    }
    if (m.kind === 'boss') {
      updateBossAI(m, dt);
      continue;
    }
    const distP = Math.hypot(P.x - m.x, P.y - m.y);
    if (m.calm > 0) {
      m.calm -= dt;
      if (m.kind === 'crawl' || m.kind === 'raider' || m.kind === 'grenadier') m.y = m.y0;
      else { m.x += (m.x0 - m.x) * Math.min(1, dt * 3); m.y += (m.y0 - m.y) * Math.min(1, dt * 3); }
    } else if (m.kind === 'wisp') {
      /* 浮眼：平时漂浮零接触伤害；靠近玩家后红瞳蓄力 -> 直线灵体冲撞（仅 charge 冲撞期间造成伤害） */
      if (m.state === 'windup') {
        m.stateT -= dt;
        if (m.stateT > 0.14 && !P.dead) m.aimAng = Math.atan2(P.y - m.y, P.x - m.x);
        m.x -= Math.cos(m.aimAng || 0) * 18 * dt;
        m.y -= Math.sin(m.aimAng || 0) * 18 * dt;
        if (m.stateT <= 0) {
          m.state = 'charge'; m.stateT = 0.28;
          const sp = 235;
          m.vx = Math.cos(m.aimAng || 0) * sp; m.vy = Math.sin(m.aimAng || 0) * sp;
          sfx('swing');
        }
      } else if (m.state === 'charge') {
        m.stateT -= dt;
        m.x = Math.max(CFG.wallT + 14, Math.min(CFG.W - CFG.wallT - 14, m.x + m.vx * dt));
        m.y += m.vy * dt;
        if (S.frames % 2 === 0) S.parts.push({ x: m.x, y: m.y, vx: -m.vx * 0.12, vy: -m.vy * 0.12, t: 0.18, c: PAL.cyan, s: 2 });
        if (!P.dead && Math.abs(m.x - P.x) < 10 + mHalf(m).x && Math.abs(m.y - P.y) < 10 + mHalf(m).y) {
          damagePlayer(m.dmg, (Math.sign(m.vx) || (P.x >= m.x ? 1 : -1)) * 165, -210, 'dash', MON_META[m.kind].name + '冲撞');
        }
        if (m.stateT <= 0) {
          m.state = 'recover'; m.stateT = 0.42; m.cd = 1.45 + rng() * 0.45;
          m.x0 = m.x; m.y0 = m.y;
        }
      } else if (m.state === 'recover') {
        m.stateT -= dt;
        if (m.stateT <= 0) m.state = 'idle';
      } else {
        m.cd = (m.cd === undefined ? 0.75 : m.cd) - dt;
        if (distP < 120 && distP > 44 && !P.dead) {
          m.x += (P.x - m.x) / (distP || 1) * 48 * dt;
          m.y += (P.y - m.y) / (distP || 1) * 48 * dt;
          m.x0 = m.x; m.y0 = m.y;
        } else {
          m.x = Math.max(CFG.wallT + 14, Math.min(CFG.W - CFG.wallT - 14, m.x0 + Math.sin(m.t * 1.7) * 24));
          m.y = m.y0 + Math.sin(m.t * 2.3) * 10;
        }
        if (m.cd <= 0 && !P.dead && distP < 106) {
          m.state = 'windup'; m.stateT = 0.38; m.aimAng = Math.atan2(P.y - m.y, P.x - m.x);
          sfx('enemylock');
        }
      }
    } else if (m.kind === 'crawl') {
      /* 刺爬：平时巡逻零接触伤害；同高度靠近后张颚预警 -> 贴地猛扑冲撞（仅 lunge 猛扑期间造成伤害） */
      if (m.state === 'windup') {
        m.stateT -= dt;
        if (m.stateT > 0.15 && !P.dead) m.dir = P.x >= m.x ? 1 : -1;
        if (m.stateT <= 0) {
          m.state = 'lunge'; m.stateT = 0.28;
          burst(m.x, m.y + 6, 4, PAL.violet); sfx('swing');
        }
      } else if (m.state === 'lunge') {
        m.stateT -= dt;
        m.x += m.dir * 215 * dt;
        let hitEdge = false;
        if (m.x <= m.x0) { m.x = m.x0; hitEdge = true; }
        if (m.x >= m.x1) { m.x = m.x1; hitEdge = true; }
        if (S.frames % 2 === 0) S.parts.push({ x: m.x - m.dir * 8, y: m.y + 6, vx: -m.dir * 24, vy: -16, t: 0.16, c: PAL.gold, s: 2 });
        if (!P.dead && Math.abs(m.x - P.x) < 12 + mHalf(m).x && Math.abs(m.y - P.y) < 10 + mHalf(m).y) {
          damagePlayer(m.dmg, m.dir * 165, -210, 'dash', MON_META[m.kind].name + '猛扑');
        }
        if (hitEdge || m.stateT <= 0) {
          m.state = 'recover'; m.stateT = 0.38; m.cd = 1.40 + rng() * 0.45;
        }
      } else if (m.state === 'recover') {
        m.stateT -= dt;
        if (m.stateT <= 0) { m.state = 'idle'; }
      } else {
        m.x += m.dir * 46 * dt;
        if (m.x < m.x0) { m.x = m.x0; m.dir = 1; }
        if (m.x > m.x1) { m.x = m.x1; m.dir = -1; }
        m.cd = (m.cd === undefined ? 0.75 : m.cd) - dt;
        if (m.cd <= 0 && !P.dead && Math.abs(P.y - m.y) < 28 && Math.abs(P.x - m.x) < 108 && (m.x1 - m.x0) >= 28) {
          m.dir = P.x >= m.x ? 1 : -1;
          m.state = 'windup'; m.stateT = 0.36; sfx('enemylock');
        }
      }
    } else if (m.kind === 'moth') {
      /* 符蛾：8 字轻悬 + 聚能扇形弹幕（普通 3 发 / 精英 5 发） */
      if (m.charge > 0) {
        m.charge -= dt;
        m.x += (m.x0 - m.x) * Math.min(1, dt * 2);
        if (m.charge <= 0 && !P.dead) {
          m.charge = 0; m.state = 'idle'; m.cd = 2.1 + rng() * 0.5;
          const base = Math.atan2(P.y - m.y, P.x - m.x);
          const offs = m.elite ? [-0.44, -0.22, 0, 0.22, 0.44] : [-0.28, 0, 0.28];
          const sp = 156;
          for (const oa of offs) {
            const a = base + oa;
            S.eshots.push({ kind: 'orb', x: m.x, y: m.y + 2, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: 5, dmg: 12, grav: 0, t: 2.6, slashable: true });
          }
          burst(m.x, m.y + 2, 4, PAL.cyan); sfx('enemyshot');
        }
      } else {
        m.x = Math.max(CFG.wallT + 16, Math.min(CFG.W - CFG.wallT - 16, m.x0 + Math.sin(m.t * 1.9) * 22));
        m.y = m.y0 + Math.sin(m.t * 3.8) * 8;
        m.cd = (m.cd === undefined ? 1.0 : m.cd) - dt;
        if (m.cd <= 0 && !P.dead && distP < 195 && Math.abs(P.y - m.y) < 145) {
          m.charge = 0.48; m.state = 'charge';
        }
      }
    } else if (m.kind === 'bomber') {
      /* 爆炎蝠：盘旋索敌 -> 红线闪烁锁定 -> 直线俯冲自爆（爆炸不可被挥砍消除） */
      if (m.state === 'lock') {
        m.stateT -= dt;
        if (m.stateT > 0.18 && !P.dead) m.aimAng = Math.atan2(P.y - m.y, P.x - m.x);
        if (m.stateT <= 0) {
          m.state = 'dive'; m.stateT = 0.85;
          const sp = 285;
          m.vx = Math.cos(m.aimAng) * sp; m.vy = Math.sin(m.aimAng) * sp;
          sfx('dive');
        }
      } else if (m.state === 'dive') {
        const py0 = m.y;
        m.x += m.vx * dt; m.y += m.vy * dt; m.stateT -= dt;
        if (S.frames % 2 === 0) S.parts.push({ x: m.x, y: m.y, vx: -m.vx * 0.15, vy: -m.vy * 0.15, t: 0.20, c: PAL.gold, s: 2 });
        let hitPlat = false;
        if (m.vy > 0) {
          for (const p of platsNear()) {
            if (m.x > p.x && m.x < p.x + p.w && m.y + 8 >= p.y - CFG.platT && py0 + 8 <= p.y - CFG.platT + 4) { hitPlat = true; break; }
          }
        }
        const hitWall = m.x <= CFG.wallT + 8 || m.x >= CFG.W - CFG.wallT - 8;
        if (Math.hypot(P.x - m.x, P.y - m.y) < 20 || hitPlat || hitWall || m.stateT <= 0) {
          m.dead = true;
          enemyExplode(m.x, m.y, 44, m.dmg, true, '爆炎蝠自爆');
          continue;
        }
      } else {
        m.x = Math.max(CFG.wallT + 16, Math.min(CFG.W - CFG.wallT - 16, m.x0 + Math.sin(m.t * 2.2) * 20));
        m.y = m.y0 + Math.cos(m.t * 2.8) * 9;
        m.cd = (m.cd === undefined ? 0.8 : m.cd) - dt;
        if (m.cd <= 0 && !P.dead && distP < 168 && Math.abs(P.y - m.y) < 132) {
          m.state = 'lock'; m.stateT = 0.52; m.aimAng = Math.atan2(P.y - m.y, P.x - m.x);
          sfx('enemylock');
        }
      }
    } else if (m.kind === 'raider') {
      /* 影刃鬼侍：平台巡逻 -> 居合寒芒锁定 -> 高速突刺斩 -> 收刀硬直 */
      if (m.state === 'aim') {
        m.stateT -= dt;
        if (m.stateT > 0.20 && !P.dead) m.dir = P.x >= m.x ? 1 : -1;
        if (m.stateT <= 0) {
          m.state = 'dash'; m.stateT = 0.26;
          burst(m.x, m.y + 10, 5, PAL.red); sfx('swing');
        }
      } else if (m.state === 'dash') {
        m.stateT -= dt;
        m.x += m.dir * 330 * dt;
        if (S.frames % 2 === 0) S.parts.push({ x: m.x - m.dir * 8, y: m.y, vx: -m.dir * 20, vy: -10, t: 0.16, c: PAL.red, s: 3 });
        let edge = false;
        if (m.x <= m.x0) { m.x = m.x0; edge = true; }
        if (m.x >= m.x1) { m.x = m.x1; edge = true; }
        if (edge || m.stateT <= 0) { m.state = 'recover'; m.stateT = 0.45; m.cd = 1.55 + rng() * 0.4; }
      } else if (m.state === 'recover') {
        m.stateT -= dt;
        if (m.stateT <= 0) m.state = 'patrol';
      } else {
        m.x += m.dir * 38 * dt;
        if (m.x <= m.x0) { m.x = m.x0; m.dir = 1; }
        if (m.x >= m.x1) { m.x = m.x1; m.dir = -1; }
        m.cd = (m.cd === undefined ? 0.8 : m.cd) - dt;
        if (m.cd <= 0 && !P.dead && Math.abs(P.y - m.y) < 34 && Math.abs(P.x - m.x) < 145) {
          m.dir = P.x >= m.x ? 1 : -1;
          m.state = 'aim'; m.stateT = 0.46; sfx('enemylock');
        }
      }
    } else if (m.kind === 'grenadier') {
      /* 掷火壶灵：高举火油壶蓄力 -> 抛物线投掷落地爆燃 */
      if (m.charge > 0) {
        m.charge -= dt;
        if (!P.dead) m.dir = P.x >= m.x ? 1 : -1;
        if (m.charge <= 0 && !P.dead) {
          m.charge = 0; m.state = 'idle'; m.cd = 2.3 + rng() * 0.5;
          const grav = 560;
          const dx = P.x - m.x, dy = (P.y - 6) - (m.y - 16);
          const flight = Math.max(0.42, Math.min(0.78, Math.abs(dx) / 190 + 0.22));
          const vx = Math.max(-210, Math.min(210, dx / flight));
          const vy = Math.max(-360, Math.min(-95, (dy - 0.5 * grav * flight * flight) / flight));
          S.eshots.push({ kind: 'bomb', x: m.x, y: m.y - 16, vx, vy, r: 6, dmg: 20, blastR: 40, grav, t: 2.8, slashable: true });
          sfx('enemyshot');
        }
      } else {
        m.x += m.dir * 24 * dt;
        if (m.x <= m.x0) { m.x = m.x0; m.dir = 1; }
        if (m.x >= m.x1) { m.x = m.x1; m.dir = -1; }
        m.cd = (m.cd === undefined ? 1.0 : m.cd) - dt;
        if (m.cd <= 0 && !P.dead && distP < 205 && Math.abs(P.y - m.y) < 170) {
          m.dir = P.x >= m.x ? 1 : -1;
          m.charge = 0.42; m.state = 'throw';
        }
      }
    } else if (m.kind === 'sniper') {
      /* 咒目魔瞳：红线实时追踪 -> 闪白锁死预警 -> 高速狙击咒枪 */
      m.y = m.y0 + Math.sin(m.t * 2.1) * 6;
      if (m.state === 'track') {
        m.stateT -= dt;
        if (P.dead || distP > 300) { m.state = 'idle'; m.cd = 1.0; }
        else {
          const want = Math.atan2(P.y - m.y, P.x - m.x);
          let da = want - m.aimAng;
          while (da > Math.PI) da -= Math.PI * 2;
          while (da < -Math.PI) da += Math.PI * 2;
          m.aimAng += Math.max(-dt * 4.8, Math.min(dt * 4.8, da));
          if (m.stateT <= 0) { m.state = 'lock'; m.stateT = 0.28; sfx('enemylock'); }
        }
      } else if (m.state === 'lock') {
        m.stateT -= dt;
        if (m.stateT <= 0 && !P.dead) {
          m.state = 'idle'; m.cd = 2.4 + rng() * 0.5;
          const sp = 360, a = m.aimAng;
          S.eshots.push({ kind: 'bolt', x: m.x + Math.cos(a) * 10, y: m.y + Math.sin(a) * 10, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, ang: a, r: 4, dmg: m.dmg, grav: 0, t: 1.6, slashable: true });
          burst(m.x + Math.cos(a) * 10, m.y + Math.sin(a) * 10, 6, PAL.red);
          sfx('enemyshot');
        }
      } else {
        m.cd = (m.cd === undefined ? 1.1 : m.cd) - dt;
        if (!P.dead) m.aimAng = Math.atan2(P.y - m.y, P.x - m.x);
        if (m.cd <= 0 && !P.dead && distP < 250 && Math.abs(P.y - m.y) < 190) {
          m.state = 'track'; m.stateT = 0.72; m.aimAng = Math.atan2(P.y - m.y, P.x - m.x);
        }
      }
    }
    /* 取消全怪物被动身体触碰扣血：影刃鬼侍仅在高速居合突刺斩 (dash) 期间造成伤害；远程/未冲撞怪可自由贴身输出 */
    if (m.kind === 'raider' && m.state === 'dash' && !P.dead) {
      if (Math.abs(m.x - P.x) < 16 + mHalf(m).x && Math.abs(m.y - P.y) < 12 + mHalf(m).y) {
        damagePlayer(m.dmg, (m.dir || 1) * 175, -220, 'dash', MON_META[m.kind].name + '居合突刺');
      }
    }
  }
  if (P.iframe > 0) P.iframe -= dt;
  S.monsters = S.monsters.filter(m => !m.dead || m.flash > 0 || m.kbT > 0);

  /* 宝箱与符文拾取 */
  for (const c of S.chests) {
    if (c.opened) continue;
    if (Math.abs(c.x - P.x) < 16 && Math.abs(c.y - P.y) < 22) {
      c.opened = true; S.flash = 0.06; burst(c.x, c.y, 12, PAL.gold); sfx('chest');
      const k = rollLoot();
      if (k === 'rune') { const ids = ['ice', 'thunder', 'feather', 'lamp']; addRune(ids[Math.floor(rng() * ids.length)]); }
      else if (k === 'heal') { P.hp = Math.min(CFG.hpMax, P.hp + CFG.healOrb); float(c.x, c.y - 12, '+' + CFG.healOrb, PAL.green); }
      else if (k === 'xp') { gainXp(25); float(c.x, c.y - 12, '+25xp', PAL.violet); }
      else { S.coins += S.richZone ? 20 : 10; S.score += S.richZone ? 20 : 10; float(c.x, c.y - 12, '+' + (S.richZone ? 20 : 10) + '金币', PAL.gold); }
    }
  }
  for (const u of S.pickups) {
    if (u.taken) continue;
    u.t += dt;
    if (Math.abs(u.x - P.x) < 16 && Math.abs(u.y - P.y) < 20) { u.taken = true; addRune(u.id); }
  }
  S.pickups = S.pickups.filter(u => !u.taken);

  for (const s of S.shots) {
    const py = s.y;
    s.x += s.vx * dt; s.vy += (s.grav || 0) * dt; s.y += s.vy * dt; s.t -= dt;
    let hitM = null, hitD = Infinity;
    for (const m of S.monsters) if (!m.dead) {
      const hb = mHalf(m);
      /* 弩箭判定放宽：箭在胸口高度平飞，小体型/贴地怪不再从头顶漏过 */
      const padX = s.explode ? 4 : 8, padY = s.explode ? 4 : 12;
      if (Math.abs(m.x - s.x) < hb.x + padX && Math.abs(m.y - s.y) < hb.y + padY) {
        const d = Math.abs(m.x - s.x);
        if (d < hitD) { hitD = d; hitM = m; }
      }
    }
    if (hitM) {
      if (s.explode) explodeAt(s.x, s.y, s.explode, s.dmg, Math.sign(s.vx)); else hurt(hitM, s.dmg, Math.sign(s.vx), false, true);
      if (S.tut) S.tut.attacked = true;
      S.trails.push({ kind: 'flash', x: s.x, y: s.y, t: 0.1 });
      s.t = 0;
    }
    /* 法球：仅在下落段穿越平台上表面时落地爆炸（避免头顶平台导致出膛即炸） */
    if (s.t > 0 && s.explode && s.vy > 40) for (const p of platsNear()) {
      if (s.x > p.x && s.x < p.x + p.w && s.y >= p.y - CFG.platT && py <= p.y - CFG.platT + 2) { explodeAt(s.x, s.y, s.explode, s.dmg, Math.sign(s.vx)); s.t = 0; break; }
    }
    if (s.x < 0 || s.x > CFG.W) s.t = 0;
  }
  S.shots = S.shots.filter(s => s.t > 0);
  for (const es of S.eshots) {
    const py0 = es.y;
    es.x += es.vx * dt;
    es.vy += (es.grav || 0) * dt;
    es.y += es.vy * dt;
    es.t -= dt;
    if (es.kind === 'bomb' && S.frames % 3 === 0) {
      S.parts.push({ x: es.x, y: es.y - 3, vx: (rng() - 0.5) * 24, vy: -20 - rng() * 18, t: 0.22, c: rng() < 0.5 ? PAL.red : PAL.gold, s: 2 });
    }
    if (es.x <= CFG.wallT + es.r || es.x >= CFG.W - CFG.wallT - es.r) {
      if (es.kind === 'bomb') enemyExplode(es.x, es.y, es.blastR || 40, es.dmg, true, '火油爆弹');
      else burst(es.x, es.y, 4, es.kind === 'bolt' ? PAL.red : (es.kind === 'arrow' ? PAL.gold : PAL.cyan));
      es.t = 0; continue;
    }
    if (es.kind === 'bomb' && es.vy > 0) {
      let landed = false;
      for (const p of platsNear()) {
        if (es.x > p.x && es.x < p.x + p.w && es.y + es.r >= p.y - CFG.platT && py0 + es.r <= p.y - CFG.platT + 4) {
          es.y = p.y - CFG.platT - 2; landed = true; break;
        }
      }
      if (landed) {
        enemyExplode(es.x, es.y, es.blastR || 40, es.dmg, true, '火油爆弹');
        es.t = 0; continue;
      }
    }
    if (!P.dead && Math.hypot(P.x - es.x, P.y - es.y) < es.r + 8) {
      if (es.kind === 'bomb') {
        enemyExplode(es.x, es.y, es.blastR || 40, es.dmg, true, '火油爆弹');
      } else {
        damagePlayer(es.dmg, (Math.sign(es.vx) || 1) * 145, -195, es.kind === 'arrow' ? 'trap' : 'shot', es.srcTag || ESHOT_SRC[es.kind] || '敌方弹幕');
        burst(es.x, es.y, 6, es.kind === 'bolt' ? PAL.red : (es.kind === 'arrow' ? PAL.gold : PAL.cyan));
      }
      es.t = 0;
    }
  }
  S.eshots = S.eshots.filter(es => es.t > 0);
  for (const b of S.eblasts) b.t -= dt;
  S.eblasts = S.eblasts.filter(b => b.t > 0);
  for (const d of S.drops) {
    d.t += dt;
    d.vy += 620 * dt;
    d.x += d.vx * dt; d.y += d.vy * dt;
    const dx = P.x - d.x, dy = P.y - d.y, dist = Math.hypot(dx, dy);
    const magnet = (d.t > d.delay && dist < 90) || d.t > 1.4;
    if (magnet && dist > 1) {
      const sp = 260 * dt;
      d.x += dx / dist * Math.min(dist, sp * (1 + d.t));
      d.y += dy / dist * Math.min(dist, sp * (1 + d.t));
    }
    if (Math.hypot(P.x - d.x, P.y - d.y) < 14) {
      d.got = true;
      if (d.kind === 'coin') { S.coins += d.v; S.score += d.v; float(P.x, P.y - 18, '+' + d.v + '金', PAL.gold); sfx('coin'); }
      else { gainXp(d.v); float(P.x, P.y - 18, '+' + d.v + 'xp', PAL.cyan); sfx('xp'); }
      burst(d.x, d.y, 4, d.kind === 'coin' ? PAL.gold : PAL.cyan);
    }
  }
  S.drops = S.drops.filter(d => !d.got && d.t < 6);
  for (const o of S.orbs) {
    o.t += dt; o.y -= 12 * dt;
    if (Math.hypot(o.x - P.x, o.y - P.y) < 16) {
      o.t = 99;
      if (o.shard) {
        S.shards++; sfx('shard');
        float(P.x, P.y - 16, '碎片 ' + S.shards + '/3', PAL.violet);
        if (S.shards >= 3) { S.shards = 0; const ids = ['ice','thunder','feather','lamp']; addRune(ids[Math.floor(rng()*4)]); }
      } else {
        P.hp = Math.min(CFG.hpMax, P.hp + CFG.healOrb);
        float(P.x, P.y - 16, '+' + CFG.healOrb, PAL.green); burst(o.x, o.y, 8, PAL.green); sfx('heal');
      }
    }
  }
  S.orbs = S.orbs.filter(o => o.t < 12);
  for (const q of S_FLOAT) { q.t -= dt; q.y -= 34 * dt; }
  while (S_FLOAT.length && S_FLOAT[0].t <= 0) S_FLOAT.shift();
  for (const q of S.parts) { q.t -= dt; q.x += q.vx * dt; q.y += q.vy * dt; q.vy += (q.grav !== undefined ? q.grav : 600) * dt; }
  S.parts = S.parts.filter(q => q.t > 0);
  for (const tr of S.trails) {
    if (tr.delay > 0) { tr.delay -= dt; continue; }
    tr.t -= dt;
  }
  S.trails = S.trails.filter(tr => tr.t > 0);

  /* 受击白金血条残影缓冲（Player & Monsters） */
  if (P.hpTrail === undefined || P.hp >= P.hpTrail) { P.hpTrail = P.hp; P.hpTrailHold = 0; }
  else if (P.hpTrailHold > 0) P.hpTrailHold -= dt;
  else P.hpTrail = Math.max(P.hp, P.hpTrail - 68 * dt);
  for (const m of S.monsters) {
    if (m.hpTrail === undefined || m.hp >= m.hpTrail) { m.hpTrail = m.hp; m.hpTrailHold = 0; }
    else if (m.hpTrailHold > 0) m.hpTrailHold -= dt;
    else m.hpTrail = Math.max(m.hp, m.hpTrail - Math.max(48, (m.max || 30) * 0.85) * dt);
  }

  /* 封锁 Boss 战期间将竞技场稳固锚定在顶部 Boss 血条与底部武器栏正中央，避免高跳晃动与 HUD 遮挡 */
  if (S.hall && hallTick(dt)) return;
  const targetCam = S.hall
    ? S.hallCam
    : ((S.arena && S.arena.active && !S.training)
      ? ((S.arena.topY + S.arena.botY) * 0.5 - CFG.H * 0.54)
      : (P.y - CFG.H * CFG.camAnchor));
  S.cam += (targetCam - S.cam) * Math.min(1, dt * 9);
  updateAnim(dt);
}

/* ---------- 渲染 ---------- */
function sy(y) { return Math.round(y - S.cam); }
/* 刀光渐隐：alpha 沿 t 分布，mask 从一端向另一端推进 */
function slashAlphaAt(t, aHead, aMid) {
  const tail = aMid * 0.28;
  if (t <= 0.55) return aHead + (aMid - aHead) * (t / 0.55);
  if (t <= 0.90) return aMid + (tail - aMid) * ((t - 0.55) / 0.35);
  return tail * (1 - (t - 0.90) / 0.10);
}
/* 低 t 端先消失（铁锤弧：t=0 是起手端） */
function slashMaskLowFirst(u0) {
  const wipe = Math.max(0, Math.min(1, u0));
  const cut = -0.30 + wipe * 1.30;
  return t => {
    const x = (t - cut) / 0.26;
    return x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
  };
}
/* 高 t 端先消失（短刀/长刀下劈：t=1 是起手端，t=0 是收刀端） */
function slashMaskHighFirst(u0) {
  const wipe = Math.max(0, Math.min(1, u0));
  const cut = 1.45 - wipe * 1.60;
  return t => {
    const x = (cut - t) / 0.26;
    return x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
  };
}
function slashGrad(cx, q, base, aHead, aMid, maskAt) {
  const h = q(0), tl = q(1);
  const g = cx.createLinearGradient(h.x, h.y, tl.x, tl.y);
  const N = 20;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const a = Math.max(0, Math.min(1, slashAlphaAt(t, aHead, aMid) * maskAt(t)));
    g.addColorStop(t, base + a.toFixed(3) + ')');
  }
  return g;
}
function render() {
  cx.setTransform(WS, 0, 0, WS, 0, 0);
  cx.save();
  if (S.shake > 0) cx.translate(Math.round((rng() - 0.5) * S.shake), Math.round((rng() - 0.5) * S.shake));
  cx.fillStyle = PAL.ink; cx.fillRect(-8, -8, CFG.W + 16, CFG.H + 16);
  const rgn = regionTheme(Math.floor(-P.y / CFG.FH));

  for (let ly = 0; ly < 2; ly++) {
    const off = ((S.cam * (ly ? 0.55 : 0.3)) % 180 + 180) % 180;
    for (let yTile = -off - 180 + ly * 40; yTile < CFG.H + 180; yTile += 180) {
      for (let x = -180; x < CFG.W + 180; x += 180) {
        /* 背景压暗：远层更暗、近层稍亮，制造纵深并把饱和度/亮度让位给前景战斗元素 */
        cx.globalAlpha = ly ? 0.50 : 0.32;
        cx.drawImage(BG, x, yTile, 180, 180);
        cx.globalAlpha = 1;
        /* 仅在前景拱壁层点亮动态摇曳壁挂火把与暖金火晕 */
        if (ly === 1 && x >= 0 && x < CFG.W) {
          for (const txOff of [30, 90, 150]) {
            const tx = x + txOff, ty = Math.round(yTile + 118);
            if (ty < -30 || ty > CFG.H + 30) continue;
            const flk = Math.sin(S.t * 11 + tx * 0.13 + ty * 0.07);
            const sw = Math.round(flk * 1.2);
            cx.fillStyle = 'rgba(' + rgn.glowA + ',' + (0.038 + 0.014 * flk).toFixed(3) + ')';
            cx.beginPath(); cx.arc(tx, ty - 4, 24 + flk * 2, 0, Math.PI * 2); cx.fill();
            cx.fillStyle = 'rgba(' + rgn.glowB + ',' + (0.055 + 0.018 * flk).toFixed(3) + ')';
            cx.beginPath(); cx.arc(tx, ty - 4, 11 + flk, 0, Math.PI * 2); cx.fill();
            px(cx, tx - 2 + sw, ty - 7, 4, 5, rgn.flame1);
            px(cx, tx - 1 + sw, ty - 9 - (flk > 0.2 ? 1 : 0), 3, 5, rgn.flame2);
            px(cx, tx, ty - 6, 1, 3, PAL.hi);
          }
        }
      }
    }
  }
  /* 楼段色温罩：随区域切换冷暖，进一步压低背景饱和/亮度，让前景战斗元素跳出（视觉层级） */
  cx.fillStyle = rgn.veil; cx.fillRect(0, 0, CFG.W, CFG.H);
  /* 地牢深渊缓升火星与墓穴浮尘（无 GC 确定性视差微粒；颜色随区域光源变化） */
  for (let i = 0; i < 20; i++) {
    const ember = i % 3 === 0;
    const sp = ember ? 26 : 11;
    const my = ((i * 73 - Math.floor(S.t * sp) - Math.floor(S.cam * 0.42)) % CFG.H + CFG.H) % CFG.H;
    const mx = Math.round(((i * 59 + Math.sin(S.t * 1.4 + i) * 9) % CFG.W + CFG.W) % CFG.W);
    px(cx, mx, my, ember ? 2 : 1, ember ? 2 : 1, ember ? rgn.ember : rgn.dust);
  }

  if (S.hall) drawHallSet(cx);
  const pf = Math.floor(-P.y / CFG.FH);
  S.drawRange = [pf - 4, pf + 9];
  for (let i = pf - 4; i <= pf + 9; i++) {
    const fl = S.floors.get(i); if (!fl) continue;
    if (fl.wall) {
      const x = fl.wall === 'L' ? 0 : CFG.W - CFG.wallT;
      const wy0 = sy(fl.y) - CFG.FH;
      for (let k = 0; k < 1; k++) cx.drawImage(WALLT, x, wy0, 24, 96);
      if (!S.dark) {
        const edgeX = fl.wall === 'L' ? CFG.wallT - 4 : CFG.W - CFG.wallT;
        cx.fillStyle = 'rgba(214,196,166,0.10)';
        cx.fillRect(edgeX, wy0 + 3, 2, 90);
        cx.fillStyle = 'rgba(235,179,75,0.035)';
        cx.fillRect(x, wy0, 24, 96);
        for (let gy = wy0 + 10; gy < wy0 + 92; gy += 22) px(cx, edgeX, gy, 2, 3, 'rgba(244,236,220,0.16)');
      }
      if (fl.spikeWall) {
        const isL = fl.wall === 'L';
        const bx = isL ? CFG.wallT - 3 : CFG.W - CFG.wallT - 1;
        px(cx, bx, wy0 + 5, 4, 80, PAL.ink);
        px(cx, bx + 1, wy0 + 6, 2, 78, PAL.stone2);
        px(cx, bx + 1, wy0 + 8, 2, 2, PAL.gold2);
        px(cx, bx + 1, wy0 + 81, 2, 2, PAL.gold2);
        for (let si = 0; si < 7; si++) {
          const sy0 = wy0 + 11 + si * 11;
          px(cx, isL ? CFG.wallT : CFG.W - CFG.wallT - 8, sy0 - 3, 8, 6, PAL.ink);
          px(cx, isL ? CFG.wallT : CFG.W - CFG.wallT - 6, sy0 - 2, 6, 4, PAL.stone3);
          px(cx, isL ? CFG.wallT : CFG.W - CFG.wallT - 5, sy0 - 2, 5, 2, PAL.hi);
          px(cx, isL ? CFG.wallT : CFG.W - CFG.wallT - 2, sy0 - 1, 2, 2, PAL.gold2);
          px(cx, isL ? CFG.wallT + 5 : CFG.W - CFG.wallT - 8, sy0 - 1, 3, 2, PAL.red);
        }
      }
    }
    const sealDim = S.arena && S.arena.active && !S.training && i > S.arena.floor + 1;
    for (const p of fl.plats) {
      if (p.gone) continue;
      const y = sy(p.y);
      if (y < -40 || y > CFG.H + 40) continue;
      if (sealDim) cx.globalAlpha = 0.16;
      for (let x = p.x; x < p.x + p.w; x += 32) {
        const w = Math.min(32, p.x + p.w - x);
        cx.save(); cx.beginPath(); cx.rect(x, y - CFG.platT, w, CFG.platT); cx.clip();
        cx.drawImage(TILE[p.type] || TILE.norm, x, y - CFG.platT, 32, 16);
        cx.restore();
      }
      /* 轮廓与顶光：加宽提亮顶缘，让台阶在压暗背景里清晰跳出（缩小/灰度下仍可辨） */
      cx.strokeStyle = PAL.ink; cx.lineWidth = 1;
      cx.strokeRect(p.x + 0.5, y - CFG.platT + 0.5, p.w - 1, CFG.platT - 1);
      const topC = p.type === 'gate' ? PAL.hi : (p.type === 'boss' ? PAL.gold : (p.type === 'ice' ? PAL.hi : (p.type === 'belt' ? PAL.gold : '#b5a6b3')));
      cx.fillStyle = topC;
      cx.fillRect(p.x + 1, y - CFG.platT, p.w - 2, 2);
      cx.fillStyle = 'rgba(244,236,220,0.10)';
      cx.fillRect(p.x + 1, y - CFG.platT + 2, p.w - 2, 1);
      cx.fillStyle = 'rgba(0,0,0,0.38)';
      cx.fillRect(p.x + 2, y, p.w - 4, 3);
      if (p.type === 'boss' && p.landing) {
        /* 50F 倍数镇楼祭坛：双侧黑曜镇魔火盆碑柱 + 中央血金战纹毯 */
        const gy = y - CFG.platT, midX = Math.round(p.x + p.w / 2);
        px(cx, midX - 44, gy, 88, 3, PAL.red2);
        px(cx, midX - 40, gy, 80, 1, PAL.gold);
        const drawBrazier = bx0 => {
          px(cx, bx0 - 5, gy - 26, 10, 26, PAL.ink);
          px(cx, bx0 - 4, gy - 25, 8, 25, '#261c38');
          px(cx, bx0 - 3, gy - 24, 2, 22, PAL.stone3);
          px(cx, bx0 + 2, gy - 24, 2, 22, PAL.gold2);
          px(cx, bx0 - 7, gy - 30, 14, 5, PAL.ink);
          px(cx, bx0 - 6, gy - 29, 12, 3, PAL.gold2);
          px(cx, bx0 - 5, gy - 29, 10, 1, PAL.gold);
          const flk = Math.round(Math.sin(S.t * 9 + bx0));
          px(cx, bx0 - 4, gy - 36, 8, 6, PAL.red);
          px(cx, bx0 - 2 + flk, gy - 40, 5, 6, PAL.gold);
          px(cx, bx0 - 1 + flk, gy - 37, 3, 3, PAL.hi);
          cx.fillStyle = 'rgba(224,60,49,0.16)';
          cx.fillRect(bx0 - 11, gy - 43, 22, 18);
        };
        drawBrazier(p.x + 18);
        drawBrazier(p.x + p.w - 18);
      }
      if (p.type === 'belt') {
        const bDir = p.beltDir || 1;
        const tStep = Math.floor(S.t * 28);
        const tread = ((tStep * bDir) % 6 + 6) % 6;
        px(cx, p.x + 2, y - CFG.platT + 2, p.w - 4, CFG.platT - 4, '#0e0b11');
        px(cx, p.x + 8, y - CFG.platT + 6, Math.max(0, p.w - 16), 2, '#1f1820');
        for (let tx = p.x + 3 + tread; tx < p.x + p.w - 4; tx += 6) {
          px(cx, tx, y - CFG.platT + 1, 2, 1, PAL.stone3);
          px(cx, tx, y - 2, 2, 1, PAL.stone2);
        }
        /* 两端机械滚轮轴承 */
        const drawPulley = px0 => {
          px(cx, px0, y - CFG.platT + 2, 6, CFG.platT - 4, PAL.ink);
          px(cx, px0 + 1, y - CFG.platT + 3, 4, CFG.platT - 6, PAL.gold2);
          const rot = (tStep >> 1) & 1;
          px(cx, px0 + 1 + rot, y - CFG.platT + 4, 2, 1, PAL.gold);
          px(cx, px0 + 2 - rot, y - 5, 2, 1, PAL.gold);
          px(cx, px0 + 2, y - CFG.platT + 7, 2, 2, PAL.hi);
        };
        drawPulley(p.x + 2);
        drawPulley(p.x + p.w - 8);
        const shift = ((tStep * bDir) % 14 + 14) % 14;
        cx.save(); cx.beginPath(); cx.rect(p.x + 9, y - CFG.platT + 2, Math.max(0, p.w - 18), CFG.platT - 4); cx.clip();
        for (let ax = p.x + 4 + shift - 14; ax < p.x + p.w - 6; ax += 14) {
          const tip = bDir > 0 ? 3 : -3;
          px(cx, ax, y - CFG.platT + 3, 3, 2, PAL.gold2);
          px(cx, ax + (tip > 0 ? 1 : -1), y - CFG.platT + 4, 3, 2, PAL.gold);
          px(cx, ax + tip, y - CFG.platT + 6, 3, 3, PAL.hi);
          px(cx, ax + (tip > 0 ? 1 : -1), y - CFG.platT + 9, 3, 2, PAL.gold);
          px(cx, ax, y - CFG.platT + 10, 3, 2, PAL.gold2);
        }
        cx.restore();
      } else if (p.type === 'ice') {
        cx.fillStyle = 'rgba(72,201,176,0.46)';
        cx.fillRect(p.x + 1, y - CFG.platT + 1, p.w - 2, CFG.platT - 2);
        cx.fillStyle = 'rgba(244,236,220,0.22)';
        cx.fillRect(p.x + 2, y - CFG.platT + 3, p.w - 4, 4);
        px(cx, p.x + 1, y - CFG.platT + 1, p.w - 2, 2, PAL.hi);
        for (let ix = p.x + 6; ix < p.x + p.w - 8; ix += 14) {
          px(cx, ix, y - CFG.platT + 3, 4, 1, PAL.hi);
          px(cx, ix + 2, y - CFG.platT + 5, 5, 1, PAL.hi);
          px(cx, ix + 5, y - CFG.platT + 8, 4, 1, PAL.cyan);
          const icH = 3 + ((ix * 7) % 4);
          px(cx, ix + 1, y, 3, 2, PAL.cyan);
          px(cx, ix + 2, y + 2, 2, icH - 1, PAL.cyan);
          px(cx, ix + 2, y, 1, 2, PAL.hi);
        }
      }
      if (p.warn) {
        cx.fillStyle = 'rgba(224,60,49,' + (0.35 + 0.3 * Math.sin(S.frames * 0.4)) + ')';
        cx.fillRect(p.x, y - CFG.platT, p.w, CFG.platT);
        for (let wx = p.x + 4; wx < p.x + p.w - 8; wx += 14) {
          px(cx, wx, y - 10, 6, 3, PAL.ink);
          px(cx, wx + 2, y - 7, 2, 3, PAL.hi);
          px(cx, wx + 1, y - 4, 4, 2, PAL.hi);
        }
      }
      if (p.blue) {
        /* 噬血蓝台：扣血前就有可读危险外观——脉动青光 + 未触发时的噬血尖齿与红警示点 */
        const pulse = p.blueHit ? 0.16 : 0.30 + 0.18 * Math.sin(S.frames * 0.18);
        cx.fillStyle = 'rgba(72,201,176,' + pulse.toFixed(3) + ')';
        cx.fillRect(p.x, y - CFG.platT, p.w, CFG.platT);
        cx.fillStyle = PAL.cyan; cx.fillRect(p.x, y - CFG.platT, p.w, 1);
        if (!p.blueHit) {
          for (let bx = p.x + 4; bx < p.x + p.w - 6; bx += 10) {
            px(cx, bx - 1, y - CFG.platT - 4, 6, 4, PAL.ink);
            px(cx, bx, y - CFG.platT - 3, 4, 3, PAL.cyan);
            px(cx, bx + 1, y - CFG.platT - 5, 2, 3, PAL.hi);
          }
          const mx = Math.round(p.x + p.w / 2);
          px(cx, mx - 1, y - CFG.platT - 6, 3, 3, PAL.red);
          px(cx, mx, y - CFG.platT - 5, 1, 1, PAL.hi);
        }
      }
      if (p.pact) {
        /* 战祭坛：血金符环 + 悬浮战纹 + 环绕火星；开启后红光增强，完成后熄灭 */
        const gy = y - CFG.platT, mx = Math.round(p.x + p.w / 2);
        const pulse = 0.5 + 0.5 * Math.sin(S.t * 3.2);
        const spent = !!p.pactDone;
        cx.fillStyle = 'rgba(224,60,49,' + (spent ? 0.05 : (0.10 + 0.09 * pulse)).toFixed(3) + ')';
        cx.beginPath(); cx.ellipse(mx, gy + 1, 24, 5, 0, 0, Math.PI * 2); cx.fill();
        px(cx, mx - 13, gy - 4, 26, 4, PAL.ink);
        px(cx, mx - 12, gy - 5, 24, 3, spent ? PAL.stone : PAL.stone2);
        px(cx, mx - 12, gy - 5, 24, 1, spent ? PAL.stone2 : PAL.gold2);
        px(cx, mx - 6, gy - 25, 12, 14, PAL.ink);
        px(cx, mx - 5, gy - 24, 10, 12, spent ? '#151013' : '#231016');
        const rc = spent ? PAL.stone : PAL.gold, rc2 = spent ? PAL.stone2 : PAL.red;
        px(cx, mx - 1, gy - 22, 3, 8, rc);
        px(cx, mx - 4, gy - 20, 9, 2, rc);
        px(cx, mx - 3, gy - 16, 7, 2, rc2);
        px(cx, mx - 1, gy - 22, 1, 8, spent ? PAL.stone2 : PAL.hi);
        if (!spent) for (let k = 0; k < 5; k++) {
          const ang = S.t * 1.4 + k * (Math.PI * 2 / 5);
          px(cx, mx + Math.round(Math.cos(ang) * 12) - 1, gy - 18 + Math.round(Math.sin(ang) * 5), 2, 2, k % 2 ? PAL.red : PAL.gold);
        }
        if (S.pact && S.pact.floor === p.floor && S.pact.state === 'fight') {
          cx.fillStyle = 'rgba(224,60,49,' + (0.16 + 0.14 * pulse).toFixed(3) + ')';
          cx.fillRect(mx - 16, gy - 34, 32, 32);
        }
      }
      if (p.type === 'gate') {
        /* 10F 门楼奇观：雕花双石柱 + 飞檐门楣 + 紫晶塔徽 + 随风轻摆像素宫灯 */
        const gy = y - CFG.platT;
        cx.fillStyle = 'rgba(64,48,42,0.48)';
        cx.fillRect(p.x + 1, gy + 1, p.w - 2, CFG.platT - 2);
        px(cx, p.x, gy, p.w, 2, PAL.gold);
        const midX = Math.round(p.x + p.w / 2);
        /* 迎宾礼毯与拱门圣光幕 */
        px(cx, midX - 20, gy, 40, 3, PAL.red);
        px(cx, midX - 18, gy, 36, 1, PAL.gold);
        cx.fillStyle = 'rgba(235,179,75,0.11)';
        cx.fillRect(midX - 32, y - 68, 64, 52);
        cx.fillStyle = 'rgba(176,124,240,0.09)';
        cx.fillRect(midX - 20, y - 64, 40, 48);
        /* 左右对称石雕门柱 */
        const drawGateCol = cx0 => {
          px(cx, cx0 - 1, y - 66, 14, 50, PAL.ink);
          px(cx, cx0, y - 65, 12, 49, PAL.stone2);
          px(cx, cx0 + 2, y - 64, 2, 46, PAL.stone3);
          px(cx, cx0 + 6, y - 64, 2, 46, PAL.stone);
          px(cx, cx0 + 9, y - 64, 2, 46, PAL.gold2);
          /* 柱础与柱头压金 */
          px(cx, cx0 - 2, gy - 6, 16, 6, PAL.ink);
          px(cx, cx0 - 1, gy - 5, 14, 5, PAL.gold2);
          px(cx, cx0, gy - 5, 12, 2, PAL.gold);
          px(cx, cx0 - 2, y - 68, 16, 6, PAL.ink);
          px(cx, cx0 - 1, y - 67, 14, 5, PAL.gold2);
          px(cx, cx0, y - 67, 12, 2, PAL.gold);
          /* 柱面符文刻点 */
          px(cx, cx0 + 4, y - 52, 3, 4, PAL.gold);
          px(cx, cx0 + 4, y - 38, 3, 4, PAL.gold);
        };
        drawGateCol(p.x + 4);
        drawGateCol(p.x + p.w - 16);
        /* 双层飞檐门楣与中央紫晶塔徽 */
        px(cx, p.x, y - 75, p.w, 8, PAL.ink);
        px(cx, p.x + 1, y - 74, p.w - 2, 6, PAL.stone2);
        px(cx, p.x + 2, y - 74, p.w - 4, 2, PAL.gold);
        px(cx, p.x + 3, y - 70, p.w - 6, 2, PAL.gold2);
        for (let dent = p.x + 8; dent < p.x + p.w - 10; dent += 10) {
          px(cx, dent, y - 72, 4, 2, PAL.stone3);
        }
        px(cx, midX - 9, y - 79, 18, 12, PAL.ink);
        px(cx, midX - 8, y - 78, 16, 10, PAL.gold2);
        px(cx, midX - 7, y - 77, 14, 2, PAL.gold);
        px(cx, midX - 4, y - 75, 8, 6, PAL.violet);
        px(cx, midX - 2, y - 74, 4, 3, PAL.hi);
        /* 门楣双宫灯 */
        const drawGateLantern = (lx, ph) => {
          const sw = Math.round(Math.sin(S.t * 2.4 + ph));
          px(cx, lx, y - 67, 1, 5, PAL.stone3);
          px(cx, lx - 3 + sw, y - 62, 7, 8, PAL.ink);
          px(cx, lx - 2 + sw, y - 62, 5, 2, PAL.gold2);
          px(cx, lx - 2 + sw, y - 60, 5, 4, PAL.gold);
          px(cx, lx - 1 + sw, y - 59, 3, 2, PAL.hi);
          px(cx, lx - 1 + sw, y - 55, 3, 1, PAL.gold2);
          cx.fillStyle = 'rgba(235,179,75,0.18)';
          cx.fillRect(lx - 7 + sw, y - 65, 15, 14);
        };
        drawGateLantern(p.x + 25, 0);
        drawGateLantern(p.x + p.w - 26, 1.8);
      }
      if (sealDim) cx.globalAlpha = 1;
    }
  }

  /* Boss 封锁竞技场：上下双向断龙铁栅与符文激光结界 */
  if (S.arena && S.arena.active) {
    const ar = S.arena;
    const meta = BOSS_META[ar.bkind] || BOSS_META.colossus;
    const ty = sy(ar.topY), by = sy(ar.botY);
    const pulse = 0.55 + 0.45 * Math.sin(S.t * 7);
    /* 竞技场两侧暗红结界边幕 */
    cx.fillStyle = 'rgba(224,60,49,0.06)';
    cx.fillRect(0, Math.max(0, ty), 10, Math.max(0, by - ty));
    cx.fillRect(CFG.W - 10, Math.max(0, ty), 10, Math.max(0, by - ty));
    /* 上封锁闸门：玄铁横梁 + 断龙獠牙刺 + 符文封禁光栅 */
    if (ty > -30 && ty < CFG.H + 30) {
      cx.fillStyle = 'rgba(224,60,49,' + (0.18 + 0.14 * pulse).toFixed(2) + ')';
      cx.fillRect(0, ty - 6, CFG.W, 20);
      px(cx, 0, ty - 4, CFG.W, 8, PAL.ink);
      px(cx, 0, ty - 3, CFG.W, 6, '#231b22');
      px(cx, 0, ty - 3, CFG.W, 2, PAL.gold2);
      px(cx, 0, ty + 2, CFG.W, 2, meta.c);
      for (let gx = 10; gx < CFG.W - 8; gx += 16) {
        px(cx, gx, ty + 4, 6, 7, PAL.ink);
        px(cx, gx + 1, ty + 4, 4, 5, PAL.stone3);
        px(cx, gx + 2, ty + 7, 2, 3, PAL.red);
        px(cx, gx + 2, ty - 1, 2, 2, PAL.gold);
      }
      /* 中央封门锁印 */
      const mx = CFG.W / 2;
      px(cx, mx - 13, ty - 7, 26, 14, PAL.ink);
      px(cx, mx - 12, ty - 6, 24, 12, PAL.gold2);
      px(cx, mx - 10, ty - 4, 20, 8, '#140e14');
      px(cx, mx - 4, ty - 2, 8, 4, PAL.red);
      px(cx, mx - 2, ty - 1, 4, 2, PAL.hi);
    }
    /* 下封锁结界：锁地赤金符阵 + 防坠断龙横栓 */
    if (by > -30 && by < CFG.H + 40) {
      cx.fillStyle = 'rgba(224,60,49,' + (0.15 + 0.12 * pulse).toFixed(2) + ')';
      cx.fillRect(0, by - 6, CFG.W, 10);
      px(cx, 0, by - 1, CFG.W, 3, PAL.red);
      px(cx, 0, by, CFG.W, 1, PAL.gold);
      for (let gx = 14; gx < CFG.W - 10; gx += 22) {
        px(cx, gx, by - 4, 4, 4, PAL.gold);
        px(cx, gx + 1, by - 3, 2, 2, PAL.hi);
      }
    }
  }

  /* 深渊：地面以下给深度感，而不是死黑 */
  const fy0 = sy(0) + 8;
  if (fy0 < CFG.H) {
    const ag = cx.createLinearGradient(0, fy0, 0, CFG.H);
    ag.addColorStop(0, 'rgba(10,8,11,0)');
    ag.addColorStop(0.3, 'rgba(5,4,7,0.78)');
    ag.addColorStop(1, 'rgba(4,3,8,0.98)');
    cx.fillStyle = ag; cx.fillRect(0, fy0, CFG.W, CFG.H - fy0);
    for (let i = 0; i < 12; i++) {
      const ex = (i * 97 + Math.floor(S.t * 18)) % CFG.W;
      const ey = CFG.H - ((i * 61 + Math.floor(S.t * 26)) % Math.max(24, CFG.H - fy0));
      px(cx, ex, ey, 2, 2, 'rgba(224,60,49,0.30)');
    }
  }

  if (S.collapseOn) {
    const y = sy(S.collapseY);
    if (y < CFG.H + 80) {
      const g = cx.createLinearGradient(0, y, 0, y + 220);
      g.addColorStop(0, 'rgba(214,63,46,0.6)'); g.addColorStop(1, 'rgba(10,8,11,0.97)');
      cx.fillStyle = g; cx.fillRect(0, y, CFG.W, CFG.H - y + 80);
      cx.fillStyle = PAL.red;
      for (let x = 0, k = 0; x < CFG.W; x += 8, k++) cx.fillRect(x, y - 3 + JAG[k % 48], 8, 3);
      cx.fillStyle = PAL.gold;
      for (let x = 4; x < CFG.W; x += 26) cx.fillRect(x, y - 6 + JAG[(x >> 3) % 48], 2, 2);
    }
  }

  for (const d of S.drops) {
    const dx = Math.round(d.x), dy = sy(d.y);
    /* 可拾取物统一语言：柔和脉动光晕＋缓慢闪烁，与高速尖锐弹幕靠形状/运动区分，而非仅颜色 */
    const gp = 0.10 + 0.05 * Math.sin(S.t * 4 + d.x * 0.05);
    cx.fillStyle = d.kind === 'coin' ? 'rgba(235,179,75,' + gp.toFixed(3) + ')' : 'rgba(72,201,176,' + gp.toFixed(3) + ')';
    cx.beginPath(); cx.arc(dx, dy, 7, 0, Math.PI * 2); cx.fill();
    if (d.kind === 'coin') {
      px(cx, dx - 3, dy - 3, 6, 6, PAL.ink);
      px(cx, dx - 2, dy - 3, 4, 6, PAL.gold2);
      px(cx, dx - 3, dy - 2, 6, 4, PAL.gold);
      px(cx, dx - 1, dy - 2, 2, 3, PAL.gold2);
      px(cx, dx - 2, dy - 2, 1, 2, PAL.hi);
    } else {
      px(cx, dx - 2, dy - 4, 4, 8, PAL.ink);
      px(cx, dx - 3, dy - 2, 6, 4, PAL.ink);
      px(cx, dx - 1, dy - 3, 2, 6, PAL.cyan);
      px(cx, dx - 2, dy - 1, 4, 2, PAL.cyan);
      px(cx, dx - 1, dy - 2, 2, 2, PAL.hi);
    }
    if (Math.floor(S.t * 3 + d.x) % 3 === 0) px(cx, dx + 3, dy - 6, 1, 1, PAL.hi);
  }
  for (const o of S.orbs) {
    const ox = Math.round(o.x), oy = sy(o.y);
    if (o.shard) {
      px(cx, ox - 5, oy - 5, 10, 10, 'rgba(176,124,240,0.20)');
      px(cx, ox - 3, oy - 4, 6, 8, PAL.ink);
      px(cx, ox - 4, oy - 3, 8, 6, PAL.ink);
      px(cx, ox - 2, oy - 3, 4, 6, PAL.violet);
      px(cx, ox - 3, oy - 2, 6, 4, PAL.violet);
      px(cx, ox - 1, oy - 2, 2, 3, PAL.hi);
    } else {
      px(cx, ox - 5, oy - 5, 10, 10, 'rgba(107,201,104,0.18)');
      px(cx, ox - 3, oy - 4, 6, 8, PAL.ink);
      px(cx, ox - 4, oy - 3, 8, 6, PAL.ink);
      px(cx, ox - 2, oy - 3, 4, 6, PAL.green);
      px(cx, ox - 3, oy - 2, 6, 4, PAL.green);
      px(cx, ox - 2, oy - 2, 2, 2, PAL.hi);
    }
  }
  for (const s of S.shots) {
    const sx = Math.round(s.x), syy = sy(s.y);
    if (s.explode) {
      cx.fillStyle = 'rgba(176,124,240,0.20)';
      cx.beginPath(); cx.arc(sx, syy, 13, 0, 7); cx.fill();
      for (let i = 1; i <= 3; i++) {
        cx.fillStyle = 'rgba(176,124,240,' + (0.30 - i * 0.08) + ')';
        cx.fillRect(sx - Math.sign(s.vx) * i * 7 - 2, syy - 2, 5, 5);
      }
      px(cx, sx - 4, syy - 4, 8, 8, PAL.violet);
      px(cx, sx - 2, syy - 2, 3, 3, PAL.hi);
    } else {
      cx.fillStyle = 'rgba(72,201,176,0.22)';
      cx.fillRect(sx - 6, syy - 3, 14, 7);
      for (let i = 1; i <= 3; i++) {
        cx.fillStyle = 'rgba(72,201,176,' + (0.34 - i * 0.09) + ')';
        cx.fillRect(sx - Math.sign(s.vx) * (6 + i * 5), syy - 1, 6, 3);
      }
      px(cx, sx - 5, syy - 1, 10, 3, PAL.cyan);
      px(cx, sx - 2, syy - 1, 4, 1, PAL.hi);
    }
  }
  for (const b of S.eblasts) {
    const k = Math.max(0, Math.min(1, 1 - b.t / (b.life || 0.28)));
    const bx = Math.round(b.x), by = sy(b.y);
    const curR = b.r * (0.28 + 0.72 * Math.pow(k, 0.52));
    const mainC = b.friendly ? PAL.gold : PAL.red;
    const subC = b.friendly ? PAL.violet : PAL.gold;
    cx.save();
    /* 外圈浓墨焦烟环，凸显暗黑明暗对比 */
    cx.strokeStyle = 'rgba(9,8,12,' + (0.65 * (1 - k)).toFixed(3) + ')';
    cx.lineWidth = Math.max(2, 5.5 * (1 - k));
    cx.beginPath(); cx.arc(bx, by, curR + 1.5, 0, Math.PI * 2); cx.stroke();
    cx.fillStyle = (b.friendly ? 'rgba(176,124,240,' : 'rgba(224,60,49,') + (0.36 * (1 - k)).toFixed(3) + ')';
    cx.beginPath(); cx.arc(bx, by, curR, 0, Math.PI * 2); cx.fill();
    cx.strokeStyle = k < 0.30 ? PAL.hi : mainC;
    cx.lineWidth = Math.max(1.4, 3.4 * (1 - k));
    cx.beginPath(); cx.arc(bx, by, curR, 0, Math.PI * 2); cx.stroke();
    cx.strokeStyle = subC;
    cx.globalAlpha = Math.max(0, 0.9 * (1 - k));
    cx.lineWidth = 1.6;
    cx.beginPath(); cx.arc(bx, by, curR * 0.60, 0, Math.PI * 2); cx.stroke();
    /* 八向爆裂像素残片与前段十字裂空火芒 */
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI * 0.25 + k * 0.35;
      const rr = curR * (0.78 + (i % 2) * 0.24);
      px(cx, Math.round(bx + Math.cos(a) * rr) - 1, Math.round(by + Math.sin(a) * rr) - 1, 3, 3, i % 2 ? mainC : PAL.ink);
    }
    if (k < 0.45) {
      const cr = Math.round(curR * 0.55);
      px(cx, bx - cr, by - 1, cr * 2, 3, PAL.ink);
      px(cx, bx - 1, by - cr, 3, cr * 2, PAL.ink);
      px(cx, bx - cr + 1, by, cr * 2 - 2, 1, PAL.hi);
      px(cx, bx, by - cr + 1, 1, cr * 2 - 2, subC);
    }
    cx.restore();
  }
  for (const es of S.eshots) {
    const ex = Math.round(es.x), ey = sy(es.y);
    if (es.kind === 'orb') {
      const ux = es.vx / 156, uy = es.vy / 156;
      px(cx, Math.round(ex - ux * 8) - 2, Math.round(ey - uy * 8) - 2, 3, 3, 'rgba(176,124,240,0.28)');
      px(cx, Math.round(ex - ux * 4) - 2, Math.round(ey - uy * 4) - 2, 4, 4, 'rgba(72,201,176,0.42)');
      px(cx, ex - 6, ey - 6, 12, 12, 'rgba(176,124,240,0.20)');
      /* 四向尖刺轮廓：攻击性星形，与圆润可拾取碎片在灰度/缩写下也分明 */
      px(cx, ex - 6, ey - 6, 2, 2, PAL.ink); px(cx, ex + 4, ey - 6, 2, 2, PAL.ink);
      px(cx, ex - 6, ey + 4, 2, 2, PAL.ink); px(cx, ex + 4, ey + 4, 2, 2, PAL.ink);
      px(cx, ex - 4, ey - 2, 8, 4, PAL.ink);
      px(cx, ex - 2, ey - 4, 4, 8, PAL.ink);
      px(cx, ex - 3, ey - 3, 6, 6, PAL.violet);
      px(cx, ex - 3, ey - 1, 6, 2, PAL.cyan);
      px(cx, ex - 1, ey - 3, 2, 6, PAL.cyan);
      px(cx, ex - 1, ey - 1, 2, 2, PAL.hi);
    } else if (es.kind === 'bolt') {
      const ang = es.ang !== undefined ? es.ang : Math.atan2(es.vy, es.vx);
      cx.save();
      cx.translate(ex, ey);
      cx.rotate(ang);
      cx.fillStyle = 'rgba(224,60,49,0.26)';
      cx.fillRect(-18, -4, 26, 8);
      px(cx, -13, -2, 21, 4, PAL.ink);
      px(cx, -12, -1, 18, 2, PAL.red);
      px(cx, 3, -3, 4, 6, PAL.ink);
      px(cx, 3, -2, 4, 4, PAL.gold);
      px(cx, -3, -1, 10, 2, PAL.hi);
      cx.restore();
    } else if (es.kind === 'bomb') {
      px(cx, ex - 5, ey - 5, 10, 10, PAL.ink);
      px(cx, ex - 4, ey - 4, 8, 8, '#7a3b1e');
      px(cx, ex - 3, ey - 4, 3, 7, '#9e532d');
      px(cx, ex - 4, ey - 2, 8, 2, PAL.gold2);
      px(cx, ex - 4, ey + 1, 8, 1, PAL.stone2);
      px(cx, ex - 2, ey - 2, 2, 2, PAL.gold);
      px(cx, ex + 1, ey - 2, 2, 2, PAL.red);
      const fl = (S.frames >> 1) % 2;
      px(cx, ex - 1, ey - 7, 2, 2, PAL.stone3);
      px(cx, ex - 1 + fl, ey - 9 - fl, 3, 3, PAL.red);
      px(cx, ex + fl, ey - 8 - fl, 2, 2, PAL.gold);
      px(cx, ex + fl, ey - 8 - fl, 1, 1, PAL.hi);
    } else if (es.kind === 'arrow') {
      const d = Math.sign(es.vx) || 1;
      cx.fillStyle = 'rgba(235,179,75,0.24)';
      cx.fillRect(ex - d * 15 - 4, ey - 2, 18, 4);
      px(cx, ex - 9, ey - 2, 18, 4, PAL.ink);
      px(cx, ex - 7, ey - 1, 14, 2, '#9c6a3e');
      /* 精钢三棱箭镞 + 尾羽双红翎 */
      const tipX = d > 0 ? ex + 4 : ex - 9;
      px(cx, tipX, ey - 3, 5, 6, PAL.ink);
      px(cx, tipX + (d > 0 ? 0 : 1), ey - 2, 4, 4, PAL.stone3);
      px(cx, tipX + (d > 0 ? 1 : 0), ey - 1, 3, 2, PAL.hi);
      const tailX = d > 0 ? ex - 8 : ex + 5;
      px(cx, tailX, ey - 3, 4, 2, PAL.red);
      px(cx, tailX, ey + 1, 4, 2, PAL.red);
      px(cx, tailX + 1, ey - 2, 2, 1, PAL.gold);
    } else if (es.kind === 'crescent') {
      /* 修罗血月剑气：弯月赤金刀罡（可被近战斩碎） */
      const d = Math.sign(es.vx) || 1;
      cx.save();
      cx.translate(ex, ey);
      if (d < 0) cx.scale(-1, 1);
      cx.fillStyle = 'rgba(224,60,49,0.24)';
      cx.fillRect(-10, -11, 20, 22);
      px(cx, -3, -11, 8, 22, PAL.ink);
      px(cx, 1, -9, 6, 18, PAL.ink);
      px(cx, -2, -10, 6, 20, PAL.red);
      px(cx, 2, -7, 4, 14, PAL.gold);
      px(cx, 4, -4, 2, 8, PAL.hi);
      px(cx, -5, -10, 4, 3, PAL.red2);
      px(cx, -5, 7, 4, 3, PAL.red2);
      cx.restore();
    }
  }
  /* Boss 竞技场区域技能与机关特效渲染 */
  for (const h of S.arenaHazards) {
    if (h.kind === 'wave') {
      const wx = Math.round(h.x), wy = sy(h.y), d = Math.sign(h.vx) || 1;
      px(cx, wx - 9, wy - 18, 18, 18, PAL.ink);
      px(cx, wx - 7, wy - 16, 14, 16, '#4d2b22');
      px(cx, wx - 5 + d * 2, wy - 18, 8, 16, PAL.red);
      px(cx, wx - 2 + d * 2, wy - 15, 4, 12, PAL.gold);
      px(cx, wx + d * 2, wy - 13, 2, 6, PAL.hi);
    } else if (h.kind === 'boulder') {
      const bx = Math.round(h.x), by = sy(h.y), gy = sy(h.groundY);
      if (h.warn > 0) {
        cx.fillStyle = 'rgba(224,60,49,0.45)';
        for (let yy = by; yy < gy; yy += 10) px(cx, bx - 1, yy, 2, 5, PAL.red);
        px(cx, bx - 8, gy - 2, 16, 2, PAL.gold);
      }
      px(cx, bx - 9, by - 9, 18, 18, PAL.ink);
      px(cx, bx - 7, by - 7, 14, 14, '#3a3034');
      px(cx, bx - 5, by - 6, 8, 5, PAL.stone3);
      px(cx, bx - 2, by - 2, 5, 5, PAL.gold);
    } else if (h.kind === 'slashbomb') {
      const sx0 = Math.round(h.x), sy0 = sy(h.y);
      const r = 10 + Math.round((1 - h.t / 0.34) * 12);
      seg(cx, sx0 - r, sy0 - r * 0.6, sx0 + r, sy0 + r * 0.6, 2, PAL.red);
      seg(cx, sx0 - r, sy0 + r * 0.6, sx0 + r, sy0 - r * 0.6, 2, PAL.gold);
      px(cx, sx0 - 3, sy0 - 3, 6, 6, PAL.hi);
    } else if (h.kind === 'pillar') {
      const px0 = Math.round(h.x), py0 = sy(h.y);
      if (h.warn > 0) {
        const blink = (S.frames >> 1) % 2 ? PAL.hi : PAL.red;
        px(cx, px0 - 12, py0 - 3, 24, 3, blink);
        px(cx, px0 - 8, py0 - 7, 16, 2, PAL.gold);
      } else {
        cx.fillStyle = 'rgba(224,60,49,0.28)';
        cx.fillRect(px0 - 14, py0 - h.h, 28, h.h);
        px(cx, px0 - 10, py0 - h.h, 20, h.h, PAL.red);
        px(cx, px0 - 6, py0 - h.h + 4, 12, h.h - 4, PAL.gold);
        px(cx, px0 - 2, py0 - h.h + 10, 4, h.h - 10, PAL.hi);
      }
    } else if (h.kind === 'lance') {
      const x1 = Math.round(h.x1), y1 = sy(h.y1), x2 = Math.round(h.x2), y2 = sy(h.y2);
      if (h.warn > 0) {
        seg(cx, x1, y1, x2, y2, 1.5, (S.frames >> 1) % 2 ? PAL.cyan : PAL.violet);
      } else {
        seg(cx, x1, y1, x2, y2, 9, 'rgba(176,124,240,0.34)');
        seg(cx, x1, y1, x2, y2, 5, PAL.cyan);
        seg(cx, x1, y1, x2, y2, 2, PAL.hi);
      }
    }
  }
  for (const tp of S.traps) drawTrap(cx, tp);
  for (const c of S.chests) if (!c.opened) drawChest(cx, c.x, sy(c.y));
  for (const u of S.pickups) drawRune(cx, u.x, sy(u.y), u.t);
  for (const n of S.npcs) {
    if (S.arena && S.arena.active && S.arena.floor === n.floor) continue;
    drawNpc(cx, n.x, sy(n.y), n.t);
  }
  for (const m of S.monsters) {
    const y = sy(m.y);
    if (y < -60 || y > CFG.H + 60) continue;
    const deadA = m.dead ? (m.kbT > 0 ? Math.max(0, Math.min(1, m.kbT / 0.16)) : (m.flash > 0 ? 1 : 0)) : 1;
    if (deadA <= 0) continue;
    cx.globalAlpha = deadA;
    /* 统一脚底接触投影（仅视觉，锚点/判定不变；dummy 自带投影，悬浮怪用淡影） */
    if (m.kind === 'boss') {
      const bf = BOSS_FOOT[m.bkind || 'colossus'];
      if (bf) unitShadow(cx, m.x, y + bf[0], bf[1], m.dormant ? Math.min(bf[2], 0.20) : bf[2]);
    } else {
      const uf = UNIT_FOOT[m.kind];
      if (uf) unitShadow(cx, m.x, y + uf[0], uf[1], uf[2]);
    }
    if (m.kind === 'wisp') drawWisp(cx, m.x, y, m.flash, m.t, m);
    else if (m.kind === 'crawl') drawCrawler(cx, m.x, y, m.flash, m.dir, m.t, m);
    else if (m.kind === 'moth') drawMoth(cx, m.x, y, m);
    else if (m.kind === 'bomber') drawBomber(cx, m.x, y, m);
    else if (m.kind === 'raider') drawRaider(cx, m.x, y, m);
    else if (m.kind === 'grenadier') drawGrenadier(cx, m.x, y, m);
    else if (m.kind === 'sniper') drawSniper(cx, m.x, y, m);
    else if (m.kind === 'turret') drawTurret(cx, m.x, y, m);
    else if (m.kind === 'dummy') drawDummy(cx, m.x, y, m.flash, m);
    else if (m.kind === 'boss') {
      if (m.bkind === 'ocular' && !m.dead && (m.bstate === 'laser_wind' || m.bstate === 'laser_fire')) {
        const lx2 = Math.round(m.x + Math.cos(m.aimAng) * 280);
        const ly2 = sy(m.y + Math.sin(m.aimAng) * 280);
        if (m.bstate === 'laser_wind') {
          seg(cx, Math.round(m.x), y, lx2, ly2, 1.5, (S.frames >> 1) % 2 ? PAL.hi : PAL.red);
        } else {
          seg(cx, Math.round(m.x), y, lx2, ly2, 15, 'rgba(224,60,49,0.30)');
          seg(cx, Math.round(m.x), y, lx2, ly2, 8, PAL.red);
          seg(cx, Math.round(m.x), y, lx2, ly2, 4, PAL.gold);
          seg(cx, Math.round(m.x), y, lx2, ly2, 2, PAL.hi);
        }
      }
      drawBoss(cx, m.x, y, m);
    }
    if (m.elite) {
      const ex0 = Math.round(m.x), ey0 = y - 30;
      px(cx, ex0 - 5, ey0 - 3, 10, 6, PAL.ink);
      px(cx, ex0 - 4, ey0, 8, 2, PAL.gold2);
      px(cx, ex0 - 4, ey0 - 2, 2, 2, PAL.gold);
      px(cx, ex0 - 1, ey0 - 3, 2, 3, PAL.gold);
      px(cx, ex0 + 2, ey0 - 2, 2, 2, PAL.gold);
      px(cx, ex0 - 1, ey0, 2, 2, PAL.red);
      px(cx, ex0 - 1, ey0 - 3, 1, 1, PAL.hi);
    }
    if (!m.dead && m.kind !== 'dummy') drawHp(cx, m);
    cx.globalAlpha = 1;
  }
  for (const tr of S.trails) {
    if (tr.delay > 0) continue;
    if (tr.kind === 'ghost' || tr.kind === 'dash') {
      const isDash = tr.kind === 'dash';
      const life = tr.life || 0.18;
      const u = Math.max(0, Math.min(1, tr.t / life));
      const a = (isDash ? 0.42 : 0.28) * u;
      if (a <= 0.01) continue;
      const tx = Math.round(tr.x), ty = sy(tr.y), df = tr.face > 0 ? 1 : -1;
      cx.save();
      cx.translate(tx, ty);
      if (df < 0) cx.scale(-1, 1);
      cx.fillStyle = isDash ? 'rgba(72,201,176,' + a.toFixed(3) + ')' : 'rgba(176,124,240,' + a.toFixed(3) + ')';
      /* 等高方盒兜帽头 + 飘扬围巾尾翼 + 前倾披风躯干 + 冲刺跨步双腿剪影（对齐 44px 视觉身高） */
      cx.fillRect(-3, -28, 11, 10);
      cx.fillRect(-5, -26, 3, 6);
      cx.fillRect(-15, -17, 11, 4);
      cx.fillRect(-21, -16, 7, 3);
      cx.fillRect(-5, -18, 11, 16);
      cx.fillRect(-9, -10, 5, 10);
      cx.fillRect(2, -2, 4, 15);
      cx.fillRect(-7, -2, 4, 13);
      if (isDash) {
        cx.fillStyle = 'rgba(244,236,220,' + Math.min(1, a * 1.35).toFixed(3) + ')';
        cx.fillRect(4, -23, 3, 2);
        cx.fillRect(-18, -16, 9, 1);
      }
      cx.restore();
    } else if (tr.kind === 'airring') {
      const life = tr.life || 0.22;
      const k = Math.max(0, Math.min(1, 1 - tr.t / life));
      const tx = Math.round(tr.x), ty = sy(tr.y);
      cx.save();
      cx.globalAlpha = Math.max(0, 1 - k);
      cx.strokeStyle = PAL.ink;
      cx.lineWidth = 3.2;
      cx.beginPath();
      if (tr.vert) cx.ellipse(tx, ty, 3 + k * 5, 7 + k * 11, 0, 0, Math.PI * 2);
      else cx.ellipse(tx, ty, 8 + k * 14, 3 + k * 4, 0, 0, Math.PI * 2);
      cx.stroke();
      cx.strokeStyle = tr.c || PAL.cyan;
      cx.lineWidth = 2;
      cx.beginPath();
      if (tr.vert) cx.ellipse(tx, ty, 3 + k * 5, 7 + k * 11, 0, 0, Math.PI * 2);
      else cx.ellipse(tx, ty, 8 + k * 14, 3 + k * 4, 0, 0, Math.PI * 2);
      cx.stroke();
      cx.strokeStyle = PAL.hi;
      cx.lineWidth = 1;
      cx.beginPath();
      if (tr.vert) cx.ellipse(tx, ty, 1.5 + k * 3, 4 + k * 7, 0, 0, Math.PI * 2);
      else cx.ellipse(tx, ty, 5 + k * 9, 1.5 + k * 2, 0, 0, Math.PI * 2);
      cx.stroke();
      cx.restore();
    }
    else if (tr.kind === 'arc') {
      /* 暗黑熔炉重击弧：浓墨黑铁背衬 + 赤焰外晕 + 锻金主刃 + 骨白极亮锋线 */
      const life = tr.life || 0.18;
      const u0 = Math.max(0, Math.min(1, 1 - tr.t / life));
      const fade = Math.pow(1 - u0, 0.45);
      if (fade <= 0.01) continue;
      const big = !!tr.big, len = tr.len || 86;
      const col = big ? 'rgba(235,179,75,' : 'rgba(72,201,176,';
      const warm = big ? 'rgba(224,60,49,' : 'rgba(72,201,176,';
      const T = (big ? 9.6 : 6.8) * (0.88 + u0 * 0.22);
      const maskAt = slashMaskLowFirst(u0);
      const q = t => {
        const x = (1 - t) * (1 - t) * 12 + 2 * (1 - t) * t * (len * 0.52) + t * t * (len * 0.94);
        const y = (1 - t) * (1 - t) * (-10) + 2 * (1 - t) * t * 32 + t * t * 4;
        const dx = 2 * (1 - t) * (len * 0.52 - 12) + 2 * t * (len * 0.94 - len * 0.52);
        const dy = 2 * (1 - t) * (32 + 10) + 2 * t * (4 - 32);
        const n = Math.hypot(dx, dy) || 1;
        return { x, y, nx: -dy / n, ny: dx / n };
      };
      const halfAt = t => {
        const tt = Math.max(0, Math.min(1, t));
        return T * (0.18 + 0.82 * Math.pow(Math.sin(Math.PI * tt), 0.62) * (0.70 + 0.30 * tt));
      };
      const band = scale => {
        cx.beginPath();
        for (let i = 0; i <= 24; i++) {
          const t = i / 24, p = q(t), h = halfAt(t) * scale;
          const x = p.x + p.nx * h, y = p.y + p.ny * h;
          if (i === 0) cx.moveTo(x, y); else cx.lineTo(x, y);
        }
        for (let i = 24; i >= 0; i--) {
          const t = i / 24, p = q(t), h = halfAt(t) * scale;
          cx.lineTo(p.x - p.nx * h, p.y - p.ny * h);
        }
        cx.closePath();
      };
      const grad = (base, aHead, aMid) => slashGrad(cx, q, base, aHead, aMid, maskAt);
      cx.save();
      cx.translate(Math.round(tr.x), sy(tr.y) - 6);
      cx.scale(tr.face, 1);
      cx.globalAlpha = fade;
      /* 暗黑地牢重墨衬边，压出强烈版画对比 */
      band(1.38); cx.fillStyle = grad('rgba(9,8,12,', 0.62, 0.24); cx.fill();
      cx.globalCompositeOperation = 'lighter';
      band(2.05); cx.fillStyle = grad(warm, 0.18, 0.06); cx.fill();
      cx.globalCompositeOperation = 'source-over';
      band(1.12); cx.fillStyle = grad(warm, 0.42, 0.16); cx.fill();
      band(0.86); cx.fillStyle = grad(col, 0.78, 0.32); cx.fill();
      band(0.48); cx.fillStyle = grad('rgba(244,236,220,', 0.98, 0.55); cx.fill();
      band(0.18); cx.fillStyle = grad('rgba(255,255,255,', 1.0, 0.42); cx.fill();
      if (u0 < 0.20) {
        const h0 = q(0), h1 = q(0.05);
        cx.strokeStyle = 'rgba(244,236,220,' + (0.95 * (1 - u0 / 0.20)).toFixed(2) + ')'; cx.lineWidth = 2.0;
        cx.beginPath();
        cx.moveTo(h0.x - (h1.x - h0.x) * 1.2, h0.y - (h1.y - h0.y) * 1.2);
        cx.lineTo(h0.x + (h1.x - h0.x) * 1.2, h0.y + (h1.y - h0.y) * 1.2);
        cx.stroke();
      }
      for (let i = 0; i < 6; i++) {
        const t = 0.05 + i * 0.10, m = maskAt(t); if (m < 0.08) continue;
        const p = q(t);
        const h = halfAt(t) * 1.65 + (i % 2) * 2;
        cx.fillStyle = i % 2 ? 'rgba(244,236,220,' + (0.90 * m).toFixed(2) + ')' : (big ? 'rgba(224,60,49,' + (0.85 * m).toFixed(2) + ')' : 'rgba(72,201,176,' + (0.85 * m).toFixed(2) + ')');
        cx.fillRect(Math.round(p.x + p.nx * h) - 1, Math.round(p.y + p.ny * h) - 1, 2, 2);
      }
      cx.restore();
    }
    else if (tr.kind === 'thrust') {
      /* 刺客淬毒冥青前刺：重墨锋套 + 冥青寒芒 + 骨白刺尖十字星 */
      const life = tr.life || 0.13;
      const u0 = Math.max(0, Math.min(1, 1 - tr.t / life));
      const fade = Math.pow(1 - u0, 0.52);
      if (fade <= 0.01) continue;
      const L = tr.len || 48, hy = -9, ty = -11;
      const headX = L;
      const T = 3.2;
      cx.save();
      cx.translate(Math.round(tr.x), sy(tr.y) - 6);
      cx.scale(tr.face, 1);
      cx.globalAlpha = fade;
      const band = (scale, fill) => {
        cx.beginPath();
        cx.moveTo(6, ty - T * scale);
        cx.lineTo(headX + scale * 1.5, hy - T * scale * 0.16);
        cx.lineTo(headX + scale * 1.5, hy + T * scale * 0.16);
        cx.lineTo(6, ty + T * scale);
        cx.closePath();
        cx.fillStyle = fill; cx.fill();
      };
      band(1.65, 'rgba(9,8,12,0.68)');
      cx.globalCompositeOperation = 'lighter';
      band(2.2, 'rgba(72,201,176,0.16)');
      cx.globalCompositeOperation = 'source-over';
      band(1.32, 'rgba(72,201,176,0.62)');
      band(0.70, 'rgba(244,236,220,0.96)');
      band(0.24, '#ffffff');
      /* 刺尖十字寒星与疾风残线 */
      cx.fillStyle = PAL.ink;
      cx.fillRect(Math.round(headX) - 3, Math.round(hy) - 3, 6, 6);
      cx.fillStyle = PAL.cyan;
      cx.fillRect(Math.round(headX) - 7, Math.round(hy) - 1, 14, 2);
      cx.fillRect(Math.round(headX) - 1, Math.round(hy) - 5, 2, 10);
      cx.fillStyle = '#ffffff';
      cx.fillRect(Math.round(headX) - 2, Math.round(hy) - 2, 4, 4);
      for (let i = 0; i < 3; i++) {
        cx.fillStyle = 'rgba(244,236,220,' + (0.30 - i * 0.07) + ')';
        cx.fillRect(10, Math.round(hy + (i - 1) * 5), Math.max(3, Math.round(headX - 16 - i * 4)), 1);
      }
      cx.restore();
    }
    else if (tr.kind === 'chop') {
      /* 居合血月斩（太刀 crimson）/ 寒芒斜劈（短刀）：暗黑浓墨煞气衬边 + 猩红/冥青刀罡 */
      const life = tr.life || 0.16;
      const u0 = Math.max(0, Math.min(1, 1 - tr.t / life));
      const fade = Math.pow(1 - u0, 0.45);
      if (fade <= 0.01) continue;
      const maskAt = slashMaskHighFirst(u0);
      const sc = tr.long ? 1.38 : 1;
      const T = (tr.long ? 6.8 : 5.1) * (0.90 + u0 * 0.15);
      const col = tr.crimson ? 'rgba(224,60,49,' : (tr.big ? 'rgba(235,179,75,' : 'rgba(72,201,176,');
      const sub = tr.crimson ? 'rgba(235,179,75,' : col;
      const q = t => {
        if (tr.long) {
          const x = ((1 - t) * (1 - t) * 10 + 2 * (1 - t) * t * 34 + t * t * 58) * sc;
          const y = ((1 - t) * (1 - t) * (-40) + 2 * (1 - t) * t * (-12) + t * t * 12) * sc;
          const dx = 2 * (1 - t) * (34 - 10) + 2 * t * (58 - 34);
          const dy = 2 * (1 - t) * (-12 + 40) + 2 * t * (12 + 12);
          const n = Math.hypot(dx, dy) || 1;
          return { x, y, nx: -dy / n, ny: dx / n };
        }
        const x = ((1 - t) * (1 - t) * 32 + 2 * (1 - t) * t * 50 + t * t * 42) * sc;
        const y = ((1 - t) * (1 - t) * 16 + 2 * (1 - t) * t * 2 + t * t * (-14)) * sc;
        const dx = 2 * (1 - t) * (50 - 32) + 2 * t * (42 - 50);
        const dy = 2 * (1 - t) * (2 - 16) + 2 * t * (-14 - 2);
        const n = Math.hypot(dx, dy) || 1;
        return { x, y, nx: -dy / n, ny: dx / n };
      };
      const half = t => {
        const tt = Math.max(0, Math.min(1, t));
        return T * (0.20 + 0.80 * Math.pow(Math.sin(Math.PI * tt), 0.62) * (0.70 + 0.30 * tt));
      };
      const band = scale => {
        cx.beginPath();
        for (let i = 0; i <= 24; i++) {
          const t = i / 24, p = q(t), h = half(t) * scale;
          const x = p.x + p.nx * h, y = p.y + p.ny * h;
          if (i === 0) cx.moveTo(x, y); else cx.lineTo(x, y);
        }
        for (let i = 24; i >= 0; i--) {
          const t = i / 24, p = q(t), h = half(t) * scale;
          cx.lineTo(p.x - p.nx * h, p.y - p.ny * h);
        }
        cx.closePath();
      };
      const grad = (base, aHead, aMid) => slashGrad(cx, q, base, aHead, aMid, maskAt);
      cx.save();
      cx.translate(Math.round(tr.x), sy(tr.y) - 6);
      cx.scale(tr.face, 1);
      cx.globalAlpha = fade;
      band(1.36); cx.fillStyle = grad('rgba(9,8,12,', 0.65, 0.25); cx.fill();
      cx.globalCompositeOperation = 'lighter';
      band(2.0); cx.fillStyle = grad(col, 0.16, 0.05); cx.fill();
      cx.globalCompositeOperation = 'source-over';
      band(1.06); cx.fillStyle = grad(col, 0.72, 0.26); cx.fill();
      band(0.72); cx.fillStyle = grad(sub, 0.82, 0.34); cx.fill();
      band(0.44); cx.fillStyle = grad('rgba(244,236,220,', 0.98, 0.50); cx.fill();
      band(0.18); cx.fillStyle = grad('rgba(255,255,255,', 1.0, 0.42); cx.fill();
      if (u0 < 0.20) {
        const h0 = q(0), h1 = q(0.06);
        cx.strokeStyle = 'rgba(244,236,220,' + (0.95 * (1 - u0 / 0.20)).toFixed(2) + ')'; cx.lineWidth = 2.0;
        cx.beginPath();
        cx.moveTo(h0.x - (h1.x - h0.x) * 1.2, h0.y - (h1.y - h0.y) * 1.2);
        cx.lineTo(h0.x + (h1.x - h0.x) * 1.2, h0.y + (h1.y - h0.y) * 1.2);
        cx.stroke();
      }
      for (let i = 0; i < 5; i++) {
        const t = 0.07 + i * 0.11, m = maskAt(t); if (m < 0.08) continue;
        const p = q(t);
        const h = half(t) * 1.7 + (i % 2) * 2;
        cx.fillStyle = i % 2 ? 'rgba(244,236,220,' + (0.88 * m).toFixed(2) + ')' : (tr.crimson ? 'rgba(224,60,49,' + (0.86 * m).toFixed(2) + ')' : 'rgba(72,201,176,' + (0.84 * m).toFixed(2) + ')');
        cx.fillRect(Math.round(p.x + p.nx * h) - 1, Math.round(p.y + p.ny * h) - 1, 2, 2);
      }
      cx.restore();
    }
    else if (tr.kind === 'ember_cleave') {
      /* 烬铁巨剑：可变厚度火焰弧罡（焦铁暗边 + 血焰 + 熔金刃芯 + 白炽前口 + 火舌与飞烬） */
      const life = tr.life || 0.24;
      const u0 = Math.max(0, Math.min(1, 1 - tr.t / life));
      const fade = Math.pow(1 - u0, 0.55);
      if (fade <= 0.01) continue;
      const R = (tr.len || 120) * (0.68 + u0 * 0.20);
      const a0 = -1.86 + u0 * 0.14;   /* 起手：上后方 */
      const a1 = 0.58 - u0 * 0.08;    /* 收势：前下方 */
      const W = (tr.h || 64) * 0.34;
      const mid = t => Math.pow(Math.sin(Math.PI * Math.max(0, Math.min(1, t))), 0.62);
      const band = (k, spike) => {
        cx.beginPath();
        const N = 34;
        for (let i = 0; i <= N; i++) {
          const t = i / N, a = a0 + (a1 - a0) * t;
          let w = W * mid(t) * k;
          if (spike) w += mid(t) * (Math.sin(t * 23 + 1.3 + u0 * 7) > 0.45 ? 4 : 0) + mid(t) * (Math.sin(t * 41 + 0.6) > 0.72 ? 2 : 0);
          const r = R + w;
          const x = Math.cos(a) * r, y = Math.sin(a) * r;
          if (i === 0) cx.moveTo(x, y); else cx.lineTo(x, y);
        }
        for (let i = N; i >= 0; i--) {
          const t = i / N, a = a0 + (a1 - a0) * t;
          const w = W * mid(t) * k;
          const r = R - w;
          cx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        cx.closePath();
      };
      const cx0 = Math.round(tr.x), cy0 = sy(tr.y);
      cx.save();
      cx.translate(cx0, cy0);
      cx.scale(tr.face, 1);
      cx.globalAlpha = fade;
      /* 1) 焦铁暗边（带火舌锯齿） */
      band(1.30, true); cx.fillStyle = 'rgba(9,8,12,0.78)'; cx.fill();
      /* 2) 血焰外层 */
      band(1.02, true); cx.fillStyle = 'rgba(150,26,16,0.90)'; cx.fill();
      /* 3) 炽炎主层 / 4) 熔金刃芯 / 5) 白炽前口 */
      cx.globalCompositeOperation = 'lighter';
      band(0.80, false); cx.fillStyle = 'rgba(224,60,49,0.65)'; cx.fill();
      band(0.56, false); cx.fillStyle = 'rgba(235,179,75,0.92)'; cx.fill();
      band(0.32, false); cx.fillStyle = 'rgba(255,246,214,0.98)'; cx.fill();
      cx.globalCompositeOperation = 'source-over';
      /* 5b) 内部熔纹：沿弧的暗红裂纹与金斑，打破平滑色带 */
      for (let i = 0; i < 9; i++) {
        const t = 0.12 + i * 0.085;
        const a = a0 + (a1 - a0) * t;
        const rr = R + (i % 3 - 1) * W * 0.34;
        cx.fillStyle = i % 3 === 0 ? 'rgba(150,26,16,0.9)' : 'rgba(235,179,75,0.9)';
        cx.fillRect(Math.round(Math.cos(a) * rr), Math.round(Math.sin(a) * rr), i % 4 === 0 ? 3 : 2, 2);
      }
      /* 6) 刀头高光（收势端） */
      for (let i = 0; i < 4; i++) {
        const t = 0.22 + i * 0.18;
        const a = a0 + (a1 - a0) * t;
        const r0 = R + W * mid(t) * 1.02;
        const fl = 8 + (i % 2) * 5;
        for (let d = 0; d < fl; d += 2) {
          const w = Math.max(1, Math.round((1 - d / fl) * 4));
          cx.fillStyle = d < fl * 0.4 ? 'rgba(224,60,49,0.9)' : 'rgba(150,26,16,0.9)';
          const rr = r0 + d;
          cx.fillRect(Math.round(Math.cos(a) * rr) - (w >> 1), Math.round(Math.sin(a) * rr) - (w >> 1), w, w);
        }
        cx.fillStyle = 'rgba(235,179,75,0.8)';
        cx.fillRect(Math.round(Math.cos(a) * (r0 + 2)), Math.round(Math.sin(a) * (r0 + 2)), 2, 2);
      }
      /* 6b) 刃头高光（收势端） */
      const hp = a1 - 0.10, hr = R + W * 0.25;
      cx.fillStyle = 'rgba(255,255,255,' + (0.9 * fade).toFixed(2) + ')';
      cx.fillRect(Math.round(Math.cos(hp) * hr) - 2, Math.round(Math.sin(hp) * hr) - 2, 4, 4);
      /* 7) 沿弧飞散的余烬 */
      for (let i = 0; i < 12; i++) {
        const t = 0.08 + i * 0.075;
        const a = a0 + (a1 - a0) * t;
        const drift = 1 + u0 * (0.10 + (i % 3) * 0.05);
        const rr = (R + W * mid(t) + 5 + (i * 7) % 9) * drift;
        const ex = Math.cos(a) * rr, ey = Math.sin(a) * rr;
        cx.fillStyle = i % 3 === 0 ? PAL.hi : (i % 3 === 1 ? PAL.gold : PAL.red);
        cx.globalAlpha = fade * (0.45 + 0.55 * ((i % 4) / 3));
        cx.fillRect(Math.round(ex), Math.round(ey), i % 4 === 0 ? 3 : 2, i % 4 === 0 ? 2 : 1);
      }
      cx.restore();
    }
    else if (tr.kind === 'ember_crack') {
      /* 烬铁巨剑落点：熔金地裂（黑缝 + 金芯 + 分叉 + 升腾火星） */
      const life = tr.life || 0.5;
      const u0 = Math.max(0, Math.min(1, 1 - tr.t / life));
      const fade = Math.pow(1 - u0, 0.7);
      if (fade <= 0.01) continue;
      const L = (tr.len || 78) * (0.55 + u0 * 0.6);
      const gy = sy(tr.y);
      cx.save();
      cx.translate(Math.round(tr.x), Math.round(gy));
      cx.scale(tr.face, 1);
      cx.globalAlpha = fade;
      const crack = [[0, 0, 20, 1], [16, 1, 38, -2], [34, -2, 56, 2], [52, 2, L, 0]];
      /* 熔光底晕 */
      cx.fillStyle = 'rgba(235,179,75,0.16)';
      cx.fillRect(0, -5, Math.round(L) + 4, 12);
      /* 黑缝主体（5px 高） */
      cx.fillStyle = 'rgba(9,8,12,0.92)';
      for (const [x1, y1, x2, y2] of crack) cx.fillRect(Math.round(x1), Math.round(Math.min(y1, y2)) - 2, Math.round(x2 - x1) + 2, 5);
      /* 熔金内芯（2px）与白热点 */
      cx.fillStyle = 'rgba(235,179,75,0.96)';
      for (const [x1, y1, x2, y2] of crack) cx.fillRect(Math.round(x1) + 1, Math.round((y1 + y2) / 2) - 1, Math.round(x2 - x1), 2);
      cx.fillStyle = 'rgba(255,246,214,0.9)';
      cx.fillRect(Math.round(L * 0.12), -1, 3, 1); cx.fillRect(Math.round(L * 0.46), 0, 2, 1);
      /* 分叉裂缝 */
      cx.fillStyle = 'rgba(224,60,49,0.85)';
      cx.fillRect(Math.round(L * 0.3), -5, 1, 6);
      cx.fillRect(Math.round(L * 0.55), 2, 1, 6);
      cx.fillRect(Math.round(L * 0.72), -4, 1, 5);
      /* 升腾火星 */
      for (let i = 0; i < 8; i++) {
        const ph = (u0 * 2.2 + i * 0.13) % 1;
        const ex = (i * 11) % Math.max(12, Math.round(L));
        cx.fillStyle = i % 2 ? PAL.gold : PAL.red;
        cx.fillRect(ex, -Math.round(3 + ph * 14), 1, 2);
      }
      cx.restore();
    }
    else if (tr.kind === 'hitspark') {
      /* 暗黑地牢标志性十字裂空受击星芒（高反差黑边衬底 + 猩红/耀金交叉斩痕 + 骨白火芯） */
      const life = tr.life || 0.14;
      const k = Math.max(0, Math.min(1, 1 - tr.t / life));
      const sx0 = Math.round(tr.x), sy0 = sy(tr.y);
      const L1 = (tr.big ? 16 : 11) * (0.65 + k * 0.55);
      const L2 = L1 * 0.58;
      cx.save();
      cx.translate(sx0, sy0);
      cx.rotate((tr.ang || 0) + 0.52);
      cx.globalAlpha = Math.max(0, 1 - k * 0.85);
      cx.fillStyle = PAL.ink;
      cx.fillRect(-Math.round(L1) - 1, -2, Math.round(L1 * 2) + 2, 5);
      cx.fillRect(-2, -Math.round(L2) - 1, 5, Math.round(L2 * 2) + 2);
      cx.fillStyle = tr.c || PAL.red;
      cx.fillRect(-Math.round(L1), -1, Math.round(L1 * 2), 3);
      cx.fillRect(-1, -Math.round(L2), 3, Math.round(L2 * 2));
      cx.fillStyle = PAL.hi;
      cx.fillRect(-Math.round(L1 * 0.65), 0, Math.round(L1 * 1.3), 1);
      cx.fillRect(-2, -2, 4, 4);
      cx.restore();
    }
    else if (tr.kind === 'slamwave') {
      /* 贴地裂石赤金冲击波：双侧翻涌像素火石柱 + 地表熔金裂带 */
      const life = tr.life || 0.28;
      const k = Math.max(0, Math.min(1, 1 - tr.t / life));
      const sx0 = Math.round(tr.x), sy0 = sy(tr.y);
      const span = Math.round((tr.r || 54) * (0.25 + 0.78 * Math.pow(k, 0.55)));
      cx.save();
      cx.globalAlpha = Math.max(0, 1 - k);
      px(cx, sx0 - span - 2, sy0 - 2, span * 2 + 4, 4, PAL.ink);
      px(cx, sx0 - span, sy0 - 1, span * 2, 2, PAL.gold);
      for (const dir of [-1, 1]) {
        for (let j = 0; j < 3; j++) {
          const wx = sx0 + dir * Math.round(span * (0.45 + j * 0.26));
          const wh = Math.max(3, Math.round((14 - j * 3) * (1 - k * 0.65)));
          px(cx, wx - 4, sy0 - wh - 1, 8, wh + 2, PAL.ink);
          px(cx, wx - 3, sy0 - wh, 6, wh, j === 0 ? PAL.gold : PAL.red);
          px(cx, wx - 1, sy0 - wh + 1, 2, Math.max(1, wh - 2), PAL.hi);
        }
      }
      cx.restore();
    }
    else if (tr.kind === 'soulring') {
      const k = 1 - tr.t / (tr.life || 0.22);
      const sx0 = Math.round(tr.x), sy0 = sy(tr.y), rr = (tr.r || 8) + k * 18;
      cx.save();
      cx.globalAlpha = Math.max(0, 1 - k);
      cx.strokeStyle = PAL.ink; cx.lineWidth = 3;
      cx.beginPath(); cx.arc(sx0, sy0, rr, 0, Math.PI * 2); cx.stroke();
      cx.strokeStyle = PAL.cyan; cx.lineWidth = 1.5;
      cx.beginPath(); cx.arc(sx0, sy0, rr, 0, Math.PI * 2); cx.stroke();
      cx.restore();
    }
    else if (tr.kind === 'muzzle') {
      const mxx = Math.round(tr.x), myy = sy(tr.y);
      const mc = tr.orb ? PAL.violet : PAL.gold;
      cx.fillStyle = tr.orb ? 'rgba(176,124,240,0.38)' : 'rgba(235,179,75,0.38)';
      cx.fillRect(mxx - 6, myy - 6, 13, 13);
      px(cx, mxx - 4, myy - 4, 9, 8, PAL.ink);
      px(cx, mxx - 3, myy - 3, 7, 6, mc);
      px(cx, mxx - 1, myy - 1, 3, 2, PAL.hi);
    } else if (tr.kind === 'flash') {
      const a = Math.max(0, tr.t / 0.1);
      cx.fillStyle = 'rgba(244,236,220,' + (0.85 * a) + ')';
      cx.beginPath(); cx.arc(Math.round(tr.x), sy(tr.y), 4 + 6 * (1 - a), 0, 7); cx.fill();
    } else if (tr.kind === 'slashpop') {
      const k = 1 - tr.t / (tr.life || 0.16);
      const sx0 = Math.round(tr.x), sy0 = sy(tr.y);
      const r = Math.round(4 + k * 10);
      cx.save();
      cx.globalAlpha = Math.max(0, 1 - k);
      seg(cx, sx0 - r, sy0 - r, sx0 + r, sy0 + r, 3, PAL.ink);
      seg(cx, sx0 - r, sy0 + r, sx0 + r, sy0 - r, 3, PAL.ink);
      seg(cx, sx0 - r, sy0 - r, sx0 + r, sy0 + r, 2, PAL.cyan);
      seg(cx, sx0 - r, sy0 + r, sx0 + r, sy0 - r, 2, PAL.hi);
      px(cx, sx0 - 2, sy0 - 2, 4, 4, PAL.hi);
      cx.restore();
    } else if (tr.kind === 'ring') {
      const k = 1 - tr.t / 0.28;
      cx.strokeStyle = 'rgba(9,8,12,' + (0.65 * (1 - k)) + ')';
      cx.lineWidth = 4;
      cx.beginPath(); cx.arc(tr.x, sy(tr.y), tr.r + k * 34, 0, 7); cx.stroke();
      cx.strokeStyle = 'rgba(235,179,75,' + (0.85 * (1 - k)) + ')';
      cx.lineWidth = 2;
      cx.beginPath(); cx.arc(tr.x, sy(tr.y), tr.r + k * 34, 0, 7); cx.stroke();
    } else {
      cx.fillStyle = 'rgba(72,201,176,0.65)';
      cx.fillRect(Math.round(tr.x) + (tr.face > 0 ? 4 : -30), sy(tr.y) - 10, 26, 3);
      cx.fillRect(Math.round(tr.x) + (tr.face > 0 ? 8 : -22), sy(tr.y) - 6, 18, 2);
    }
  }
  for (const q of S.parts) {
    const qx = Math.round(q.x), qy = sy(q.y);
    if (q.soul) {
      px(cx, qx - 1, qy - 2, 3, 5, 'rgba(72,201,176,0.32)');
      px(cx, qx - 2, qy - 1, 5, 3, 'rgba(72,201,176,0.32)');
      px(cx, qx - 1, qy - 1, 3, 3, q.c);
      px(cx, qx, qy, 1, 1, PAL.hi);
    } else {
      px(cx, qx, qy + 1, q.s, q.s, PAL.ink);
      px(cx, qx, qy, q.s, q.s, q.c);
      if (q.hi && q.s >= 3) px(cx, qx, qy, 1, 1, PAL.hi);
    }
  }

  if (!P.dead) {
    const blink = P.iframe > 0 && P.dodgeT <= 0 && (S.frames >> 2) % 2 === 0;
    if (!blink) {
      if (P.onGround) unitShadow(cx, P.x, sy(P.y) + Math.round(P.h / 2), 22, 0.34); /* 统一脚底投影，对齐脚底锚点 */
      drawHeroComposite(cx, P.x, sy(P.y), P.anim, P.face);
    }
    if (S.emberShield) {
      const sx0 = Math.round(P.x), sy0 = sy(P.y) - 4;
      cx.save();
      cx.strokeStyle = PAL.ink; cx.lineWidth = 3;
      cx.beginPath(); cx.arc(sx0, sy0, 20 + Math.sin(S.t * 6) * 1.5, 0, Math.PI * 2); cx.stroke();
      cx.strokeStyle = 'rgba(235,179,75,0.84)';
      cx.lineWidth = 1.6;
      cx.beginPath(); cx.arc(sx0, sy0, 20 + Math.sin(S.t * 6) * 1.5, 0, Math.PI * 2); cx.stroke();
      for (let k = 0; k < 4; k++) {
        const a = S.t * 2.8 + k * Math.PI * 0.5;
        px(cx, Math.round(sx0 + Math.cos(a) * 20) - 2, Math.round(sy0 + Math.sin(a) * 20) - 2, 4, 4, PAL.ink);
        px(cx, Math.round(sx0 + Math.cos(a) * 20) - 1, Math.round(sy0 + Math.sin(a) * 20) - 1, 2, 2, PAL.gold);
      }
      cx.restore();
    }
  } else if (S.deathT < 0.5) {
    const di = Math.min(3, Math.floor(S.deathT / 0.125));
    if (DEATH_READY >= 4) { drawHeroAI(cx, P.x, sy(P.y), di, P.face, 0, DEATH_IMGS); S.lastDraw = 'death'; }
  }

  if (S.showHit) {
    cx.strokeStyle = 'rgba(224,60,49,0.9)'; cx.lineWidth = 1;
    cx.strokeRect(P.x - P.w / 2, sy(P.y) - P.h / 2, P.w, P.h);
    cx.strokeStyle = 'rgba(72,201,176,0.9)';
    cx.beginPath(); cx.moveTo(P.x - 10, sy(P.y) + P.h / 2); cx.lineTo(P.x + 10, sy(P.y) + P.h / 2); cx.stroke();
    cx.beginPath(); cx.moveTo(P.x, sy(P.y) - 30); cx.lineTo(P.x, sy(P.y) + 22); cx.stroke();
    cx.strokeStyle = 'rgba(235,179,75,0.75)';
    for (const m of S.monsters) if (!m.dead) { const hb = mHalf(m); cx.strokeRect(m.x - hb.x, sy(m.y) - hb.y, hb.x * 2, hb.y * 2); }
    cx.strokeStyle = 'rgba(176,124,240,0.85)';
    for (const es of S.eshots) { cx.beginPath(); cx.arc(es.x, sy(es.y), es.r, 0, 7); cx.stroke(); }
    cx.strokeStyle = 'rgba(224,60,49,0.85)';
    for (const b of S.eblasts) { cx.beginPath(); cx.arc(b.x, sy(b.y), b.r, 0, 7); cx.stroke(); }
  }
  /* 角色随身地牢火把暖光晕 */
  cx.globalCompositeOperation = 'lighter';
  const lg = cx.createRadialGradient(P.x, sy(P.y) - 6, 8, P.x, sy(P.y) - 6, 132);
  lg.addColorStop(0, 'rgba(235,179,75,0.14)');
  lg.addColorStop(0.55, 'rgba(224,60,49,0.04)');
  lg.addColorStop(1, 'rgba(0,0,0,0)');
  cx.fillStyle = lg; cx.fillRect(0, 0, CFG.W, CFG.H);
  cx.globalCompositeOperation = 'source-over';
  /* 暗黑地牢深渊重墨暗角（Chiaroscuro Vignette）：无「别回头」规则时收弱，保证两侧爬墙墙面可读 */
  const vgEdge = S.dark ? 0.34 : 0.19;
  const vg = cx.createRadialGradient(CFG.W / 2, CFG.H * 0.52, 200, CFG.W / 2, CFG.H * 0.52, 470);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(5,4,8,' + vgEdge + ')');
  cx.fillStyle = vg; cx.fillRect(0, 0, CFG.W, CFG.H);
  /* 无视野遮蔽时给两侧墙沿一道冷岩补光，爬墙落点看得清 */
  if (!S.dark && S.screen === 'playing') {
    cx.globalCompositeOperation = 'lighter';
    const wl = cx.createLinearGradient(0, 0, CFG.wallT + 26, 0);
    wl.addColorStop(0, 'rgba(150,170,210,0.10)'); wl.addColorStop(1, 'rgba(0,0,0,0)');
    cx.fillStyle = wl; cx.fillRect(0, 0, CFG.wallT + 26, CFG.H);
    const wr = cx.createLinearGradient(CFG.W, 0, CFG.W - CFG.wallT - 26, 0);
    wr.addColorStop(0, 'rgba(150,170,210,0.10)'); wr.addColorStop(1, 'rgba(0,0,0,0)');
    cx.fillStyle = wr; cx.fillRect(CFG.W - CFG.wallT - 26, 0, CFG.wallT + 26, CFG.H);
    cx.globalCompositeOperation = 'source-over';
  }

  /* 受击与濒死动脉血雾脉冲边框（Arterial Blood Vignette） */
  if (S.screen === 'playing' && !P.dead && ((P.hurtT || 0) > 0 || P.hp <= CFG.hpMax * 0.3)) {
    const hurtA = (P.hurtT || 0) > 0 ? Math.min(0.42, P.hurtT * 1.4) : 0;
    const lowA = P.hp <= CFG.hpMax * 0.3 ? (0.14 + 0.10 * Math.sin(S.t * 6.5)) : 0;
    const ba = Math.max(hurtA, lowA);
    const bg = cx.createRadialGradient(CFG.W / 2, CFG.H * 0.5, 130, CFG.W / 2, CFG.H * 0.5, 380);
    bg.addColorStop(0, 'rgba(150,30,30,0)');
    bg.addColorStop(1, 'rgba(190,28,24,' + ba.toFixed(3) + ')');
    cx.fillStyle = bg; cx.fillRect(0, 0, CFG.W, CFG.H);
    /* 屏幕边缘像素血痕压框 */
    const frameA = (ba * 0.65).toFixed(3);
    px(cx, 0, 0, CFG.W, 4, 'rgba(150,30,30,' + frameA + ')');
    px(cx, 0, CFG.H - 4, CFG.W, 4, 'rgba(150,30,30,' + frameA + ')');
    px(cx, 0, 0, 4, CFG.H, 'rgba(150,30,30,' + frameA + ')');
    px(cx, CFG.W - 4, 0, 4, CFG.H, 'rgba(150,30,30,' + frameA + ')');
  }

  if (S.flash > 0) { cx.fillStyle = 'rgba(244,236,220,' + (S.flash * 2.6) + ')'; cx.fillRect(0, 0, CFG.W, CFG.H); }

  cx.restore();
  drawUILayer();
}

/* ---------- 界面层 v4：像素暗黑地牢 · 哥特铁艺鎏金设计系统 ---------- */
const M = 16;
const UIF = '"Microsoft YaHei UI","Microsoft YaHei","PingFang SC",sans-serif';
const UIS = '"Noto Serif SC","Source Han Serif SC","Songti SC","STZhongsong","STSong","SimSun",serif';
const UIN = '"Palatino Linotype","Book Antiqua",Palatino,Georgia,serif';
const UC = {
  ink: '#0a080b', deep: '#070609', panel: '#17121a', panel2: '#201820',
  line: 'rgba(192,141,62,0.30)', line2: 'rgba(244,236,220,0.06)',
  hi: '#efe4cf', mut: '#c4b298', stone: '#917a6d',
  bone: '#d9c9aa', brass: '#c08d3e', brass2: '#6e4c1e', iron: '#241d22', iron2: '#3e3336', blood: '#8f1d1d', parch: '#ecdcb8',
};
function hexA(h, a) {
  if (!h || h[0] !== '#') return h;
  const n = parseInt(h.slice(1, 7), 16);
  return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
}
function hitBox(x, y, w, h, act) { S.hit.push({ x, y, w, h, act }); }
function reasonText(r, srcTag) {
  if (r === 'collapse') return '被崩落线吞没';
  if (r === 'time') return '沙漏流尽';
  if (r === 'blue') return '误踩噬血蓝台';
  if (srcTag) return '死于' + srcTag;
  return { contact: '力竭倒于魔物爪下', shot: '被敌方弹幕击中', explode: '殁于爆裂冲击', trap: '误触塔楼机关', dash: '被高速突袭击中', debug: '命运终结' }[r] || '魔塔收下了你';
}
/* 结算复盘：按最后伤害来源给出一条可立即执行的行为建议 */
function deathAdvice(r, srcTag) {
  const s = srcTag || '';
  if (r === 'collapse') return '别在低层停留；看到裂纹就提前找上一层落点。';
  if (r === 'time') return '路线优先连续台阶，少绕路、少恋战。';
  if (r === 'blue') return '青色尖齿台阶会咬人，换一条路线。';
  if (/落石|巨岩/.test(s)) return '看到顶部落点预警后，先横向避让再继续上跳。';
  if (/地刺|火口|回旋锯|刺墙|机关/.test(s)) return '等机关收起或预警结束再落脚，必要时用闪避越过。';
  if (/弩箭|咒弹|狙|弹幕|火柱|光枪|咒枪/.test(s)) return '用闪避无敌帧穿越，或挥砍斩落可破坏的飞行弹幕。';
  if (/爆炎蝠|爆裂|火油/.test(s)) return '看到红线锁定就立刻拉开距离，别站在落点附近。';
  if (/冲撞|猛扑|突刺|斩落|魔物/.test(s)) return '先等对方蓄力红线亮起，再侧向闪避或跳到上层。';
  return '下一次先观察危险预警，再决定打、绕或继续向上。';
}

function uiFont(size, weight, serif) { U.font = (weight ? weight + ' ' : '') + size + 'px ' + ((serif || size >= 12) ? UIS : UIF); }
function uiText(x, y, s, size, color, align) {
  U.textAlign = align || 'left'; uiFont(size, size >= 12 ? '700' : '');
  if (size >= 9) { U.fillStyle = 'rgba(5,4,6,0.9)'; U.fillText(s, x + 1, y + 1); }
  U.fillStyle = color; U.fillText(s, x, y); U.textAlign = 'left';
}
function uiNum(x, y, s, size, color, align, weight) {
  U.textAlign = align || 'left'; U.font = (weight || '700') + ' ' + size + 'px ' + UIN;
  if (size >= 10) { U.fillStyle = 'rgba(5,4,6,0.92)'; U.fillText(s, x + 1, y + 1); }
  U.fillStyle = color; U.fillText(s, x, y); U.textAlign = 'left';
  return U.measureText(s).width;
}
function uiTrack(x, y, s, size, color, align, track) {
  track = track === undefined ? 1.4 : track;
  U.font = '700 ' + size + 'px ' + UIS;
  let w = 0; for (const ch of s) w += U.measureText(ch).width + track;
  w = Math.max(0, w - track);
  let px0 = x;
  if (align === 'center') px0 = x - w / 2; else if (align === 'right') px0 = x - w;
  U.textAlign = 'left'; U.fillStyle = color;
  for (const ch of s) { U.fillText(ch, px0, y); px0 += U.measureText(ch).width + track; }
  return w;
}
/* 细铜丝分隔线 */
function uiRule(y, x, w, color) {
  x = Math.round(x === undefined ? M : x); w = Math.round(w === undefined ? CFG.W - M * 2 : w);
  px(U, x, Math.round(y), w, 1, color || UC.line);
  px(U, x, Math.round(y) + 1, w, 1, 'rgba(0,0,0,0.45)');
}
/* 哥特菱心剑形分隔饰带 */
function uiDivider(y, x, w, c) {
  x = Math.round(x === undefined ? M : x); w = Math.round(w === undefined ? CFG.W - M * 2 : w); c = c || UC.brass; y = Math.round(y);
  const mx = Math.round(x + w / 2);
  px(U, x + 8, y, w - 16, 1, hexA(c, 0.55));
  px(U, x + 8, y + 1, w - 16, 1, 'rgba(0,0,0,0.5)');
  px(U, x + 2, y, 5, 1, hexA(c, 0.22)); px(U, x + w - 7, y, 5, 1, hexA(c, 0.22));
  for (const s of [-1, 1]) {
    px(U, mx + s * 16 - 1, y - 1, 3, 3, UC.ink); px(U, mx + s * 16, y, 1, 1, c);
    px(U, mx + s * 9 - 2, y - 1, 5, 3, UC.ink); px(U, mx + s * 9 - 1, y, 3, 1, hexA(c, 0.9));
  }
  px(U, mx - 4, y - 2, 9, 5, UC.ink); px(U, mx - 2, y - 4, 5, 9, UC.ink);
  px(U, mx - 3, y, 7, 1, c); px(U, mx, y - 3, 1, 7, c); px(U, mx - 1, y - 1, 3, 3, c); px(U, mx, y, 1, 1, UC.hi);
}
function uiDot(y, x, w, color) { uiDivider(y, x, w); }
/* 铁艺鎏金框：外墨线 + 熟铁边 + 内凹斜面 + 内铜丝 + 四角菱钉 + 石纹微噪 */
function uiFrame(x, y, w, h, o) {
  o = o || {};
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  const ac = o.accent || UC.brass;
  px(U, x - 2, y - 2, w + 4, h + 4, UC.ink);
  px(U, x - 1, y - 1, w + 2, h + 2, o.rim || UC.iron2);
  px(U, x, y, w, h, o.fill || 'rgba(20,15,19,0.96)');
  px(U, x, y, w, 1, 'rgba(244,236,220,0.08)');
  px(U, x, y + h - 2, w, 2, 'rgba(0,0,0,0.5)');
  if (o.grain !== false && w * h > 1200) {
    let sd = (x * 31 + y * 17) | 0;
    const n = Math.min(60, Math.floor(w * h / 700));
    for (let i = 0; i < n; i++) {
      sd = (sd * 9301 + 49297) % 233280;
      const gx = x + 4 + (sd % Math.max(1, w - 8));
      sd = (sd * 9301 + 49297) % 233280;
      const gy = y + 4 + (sd % Math.max(1, h - 8));
      px(U, gx, gy, i % 3 ? 1 : 2, 1, i % 2 ? 'rgba(244,236,220,0.035)' : 'rgba(0,0,0,0.25)');
    }
  }
  if (o.double !== false && w > 14 && h > 14) {
    const c2 = hexA(ac, o.hot ? 0.75 : 0.38);
    px(U, x + 3, y + 3, w - 6, 1, c2); px(U, x + 3, y + h - 4, w - 6, 1, c2);
    px(U, x + 3, y + 3, 1, h - 6, c2); px(U, x + w - 4, y + 3, 1, h - 6, c2);
  }
  if (o.top) { px(U, x + 6, y - 1, w - 12, 2, o.top); px(U, x + 10, y - 1, w - 20, 1, hexA(UC.hi, 0.35)); }
  if (o.rivets !== false) {
    for (const [cx0, cy0] of [[x, y], [x + w - 1, y], [x, y + h - 1], [x + w - 1, y + h - 1]]) {
      px(U, cx0 - 2, cy0 - 1, 5, 3, UC.ink); px(U, cx0 - 1, cy0 - 2, 3, 5, UC.ink);
      px(U, cx0 - 1, cy0, 3, 1, ac); px(U, cx0, cy0 - 1, 1, 3, ac); px(U, cx0, cy0, 1, 1, UC.hi);
    }
  }
}
/* 像素骷髅徽记 */
function uiSkull(x, y, c, s) {
  s = s || 1; c = c || UC.bone;
  const Q = (a, b, w, h, col) => px(U, Math.round(x + a * s), Math.round(y + b * s), Math.ceil(w * s), Math.ceil(h * s), col);
  Q(-4, -5, 9, 8, UC.ink); Q(-3, 3, 7, 3, UC.ink);
  Q(-3, -4, 7, 6, c); Q(-2, 2, 5, 3, c);
  Q(-3, -4, 3, 1, 'rgba(255,255,255,0.32)');
  Q(-2, -2, 2, 2, UC.ink); Q(1, -2, 2, 2, UC.ink); Q(0, 1, 1, 1, UC.ink);
  Q(-1, 3, 1, 2, UC.ink); Q(1, 3, 1, 2, UC.ink);
}
/* 残烛（摇曳火苗） */
function uiCandle(x, y, T, h) {
  h = h || 10; x = Math.round(x); y = Math.round(y);
  const fl = Math.sin(T * 9 + x) > 0 ? 1 : 0;
  U.fillStyle = 'rgba(235,179,75,0.14)'; U.beginPath(); U.arc(x + 1, y - h - 3, 8, 0, 7); U.fill();
  px(U, x - 2, y - h, 6, h + 1, UC.ink); px(U, x - 1, y - h + 1, 4, h - 1, '#d6c6a4'); px(U, x - 1, y - h + 1, 1, h - 1, '#f2e6cc');
  px(U, x - 1, y - h + 2, 2, 3, '#b8a582');
  px(U, x, y - h - 5 - fl, 2, 4 + fl, PAL.gold); px(U, x, y - h - 2, 2, 2, PAL.red); px(U, x, y - h - 4, 1, 2, UC.hi);
}
/* 旧条码 → 改为墓窟骷髅残烛小饰件 */
function uiBarcode(x, y, w, h, seed) {
  const T = performance.now() / 1000;
  uiSkull(x + 8, y + h / 2 + 2, UC.stone, 1);
  uiCandle(x + 22, y + h + 2, T + (seed || 0), 8);
  for (let i = 30; i < w; i += 6) px(U, x + i, y + h / 2 + 2, 3, 1, UC.line);
}
function uiSeg(x, y, w, h, ratio, color, n, bg) {
  x = Math.round(x); y = Math.round(y); w = Math.round(w);
  px(U, x - 2, y - 2, w + 4, h + 4, UC.ink);
  px(U, x - 1, y - 1, w + 2, h + 2, UC.iron2);
  px(U, x, y, w, h, bg || '#140d10');
  const fw = Math.max(0, Math.min(1, ratio)) * w;
  if (fw > 0) {
    px(U, x, y, Math.max(1, Math.round(fw)), h, color);
    px(U, x, y, Math.max(1, Math.round(fw)), 1, 'rgba(255,240,220,0.35)');
    if (h > 3) px(U, x, y + h - 1, Math.max(1, Math.round(fw)), 1, 'rgba(0,0,0,0.35)');
  }
  n = n || 6;
  for (let i = 1; i < n; i++) px(U, Math.round(x + w * i / n), y, 1, h, 'rgba(5,4,6,0.75)');
}
/* 鲜血药瓶长槽（含受击白金残影） */
function uiVial(x, y, w, h, ratio, trail, col) {
  x = Math.round(x); y = Math.round(y);
  px(U, x - 2, y - 2, w + 4, h + 4, UC.ink);
  px(U, x - 1, y - 1, w + 2, h + 2, UC.brass2);
  px(U, x, y, w, h, '#1a0b0d');
  const tw = Math.round(w * Math.max(0, Math.min(1, trail)));
  if (tw > 0) px(U, x, y, tw, h, 'rgba(255,236,200,0.85)');
  const fw = Math.round(w * Math.max(0, Math.min(1, ratio)));
  if (fw > 0) {
    px(U, x, y, fw, h, col === 'low' ? '#7a1414' : '#8a1a18');
    px(U, x, y, fw, h - 2, col === 'low' ? '#b02018' : PAL.red);
    px(U, x, y + 1, fw, 1, '#ff8a6e');
    for (let i = 6; i < fw - 2; i += 11) px(U, x + i, y + 3, 2, 1, 'rgba(255,190,160,0.45)');
  }
  for (let i = 1; i < 10; i++) px(U, x + Math.round(w * i / 10), y + h - 2, 1, 2, 'rgba(5,4,6,0.8)');
  px(U, x + w + 1, y - 3, 3, h + 6, UC.ink); px(U, x + w + 1, y - 2, 2, h + 4, UC.brass);
}
/* 炼金血瓶图标 */
function uiFlask(cx, cy, ratio, low) {
  cx = Math.round(cx); cy = Math.round(cy);
  px(U, cx - 4, cy - 16, 8, 4, UC.ink); px(U, cx - 3, cy - 15, 6, 2, '#7a4b2c');
  px(U, cx - 3, cy - 12, 6, 5, UC.ink); px(U, cx - 2, cy - 12, 4, 5, '#2a1a1e');
  px(U, cx - 9, cy - 7, 18, 17, UC.ink); px(U, cx - 8, cy - 8, 16, 19, UC.ink);
  px(U, cx - 7, cy - 6, 14, 15, '#1d0d10');
  const lh = Math.round(15 * Math.max(0, Math.min(1, ratio)));
  if (lh > 0) {
    px(U, cx - 7, cy + 9 - lh, 14, lh, low ? '#9a1a16' : PAL.red);
    px(U, cx - 7, cy + 9 - lh, 14, 1, '#ff9a7c');
    px(U, cx + 2, cy + 9 - lh + 2, 4, Math.max(0, lh - 3), 'rgba(0,0,0,0.25)');
  }
  px(U, cx - 6, cy - 5, 2, 6, 'rgba(255,255,255,0.32)');
  px(U, cx - 9, cy - 1, 18, 1, UC.brass2);
}
function uiTag(x, y, label, fill, fg, size, pad, align) {
  size = size || 9; pad = pad || 7;
  uiFont(size, '700'); const tw = U.measureText(label).width;
  const w = tw + pad * 2, h = size + 8;
  let x0 = x; if (align === 'center') x0 = x - w / 2; else if (align === 'right') x0 = x - w;
  x0 = Math.round(x0); y = Math.round(y);
  px(U, x0 - 1, y - 1, Math.ceil(w) + 2, h + 2, UC.ink);
  px(U, x0, y, Math.ceil(w), h, fill);
  px(U, x0, y, Math.ceil(w), 1, 'rgba(244,236,220,0.14)');
  U.textAlign = 'left'; uiFont(size, '700'); U.fillStyle = fg; U.fillText(label, x0 + pad, y + h / 2 + size * 0.36);
  return w;
}
function uiKeycap(x, y, w, h, label, size, accent) {
  x = Math.round(x); y = Math.round(y);
  px(U, x - 1, y - 1, w + 2, h + 4, UC.ink);
  px(U, x, y, w, h + 2, '#120d10');
  px(U, x, y, w, h, '#2a2125');
  px(U, x, y, w, 1, accent || UC.brass);
  px(U, x + 1, y + 1, w - 2, 1, 'rgba(244,236,220,0.10)');
  px(U, x, y + 1, 1, h - 1, 'rgba(244,236,220,0.06)');
  U.textAlign = 'center'; U.font = '700 ' + (size || 10) + 'px ' + UIN; U.fillStyle = UC.bone;
  U.fillText(label, x + w / 2, y + h / 2 + (size || 10) * 0.36); U.textAlign = 'left';
}
function uiHatch(x, y, w, h, color, step, phase) {
  step = step || 6; phase = phase || 0;
  U.save(); U.beginPath(); U.rect(x, y, w, h); U.clip();
  U.strokeStyle = color; U.lineWidth = 1;
  for (let i = -h - step; i < w + h; i += step) {
    U.beginPath(); U.moveTo(x + i + phase, y + h); U.lineTo(x + i + h + phase, y); U.stroke();
  }
  U.restore();
}
/* 像素剑尖箭头 */
function uiChevron(x, y, c, dir) {
  x = Math.round(x); y = Math.round(y); const d = dir < 0 ? -1 : 1;
  for (let i = 0; i < 5; i++) {
    px(U, x - d * (4 - i) - 1, y - 5 + i, 3, 1, UC.ink); px(U, x - d * (4 - i) - 1, y + 5 - i, 3, 1, UC.ink);
    px(U, x - d * (4 - i), y - 4 + i, 1, 1, c); px(U, x - d * (4 - i), y + 4 - i, 1, 1, c);
  }
  px(U, x - 1, y - 1, 3, 3, UC.ink); px(U, x, y, 1, 1, c);
}
function uiIcon(x, y, s, c, kind) {
  px(U, x - 1, y - 1, 18, 18, 'rgba(5,4,6,0.35)');
  if (kind === 'hammer') { px(U, x, y + 2, 14, 6, UC.ink); px(U, x + 1, y + 3, 12, 4, c); px(U, x + 5, y + 7, 5, 10, UC.ink); px(U, x + 6, y + 7, 3, 9, '#7a4b2c'); px(U, x + 2, y + 3, 10, 1, UC.hi); }
  else if (kind === 'orb') { px(U, x + 3, y + 3, 11, 11, UC.ink); px(U, x + 4, y + 4, 9, 9, c); px(U, x + 6, y + 6, 5, 5, UC.ink); px(U, x + 7, y + 7, 2, 2, UC.hi); }
  else if (kind === 'slot') { px(U, x, y + 3, 8, 11, UC.ink); px(U, x + 8, y + 3, 8, 11, UC.ink); px(U, x + 1, y + 4, 6, 9, c); px(U, x + 9, y + 4, 6, 9, c); }
  else if (kind === 'revive') { px(U, x + 5, y + 1, 6, 15, UC.ink); px(U, x, y + 5, 16, 6, UC.ink); px(U, x + 6, y + 2, 4, 13, c); px(U, x + 1, y + 6, 14, 4, c); px(U, x + 7, y + 3, 1, 11, UC.hi); }
  else if (kind === 'sword') {
    px(U, x + 6, y, 5, 13, UC.ink); px(U, x + 7, y + 1, 3, 11, c); px(U, x + 8, y + 2, 1, 8, UC.hi);
    px(U, x + 3, y + 10, 11, 4, UC.ink); px(U, x + 4, y + 11, 9, 2, PAL.gold); px(U, x + 7, y + 13, 3, 3, c);
  } else if (kind === 'wing') {
    px(U, x + 1, y + 3, 13, 5, UC.ink); px(U, x + 2, y + 4, 11, 3, c); px(U, x + 4, y + 8, 9, 2, UC.hi); px(U, x + 6, y + 11, 7, 2, c);
  } else if (kind === 'shield') {
    px(U, x + 2, y + 1, 12, 10, UC.ink); px(U, x + 4, y + 10, 8, 4, UC.ink);
    px(U, x + 3, y + 2, 10, 8, c); px(U, x + 5, y + 10, 6, 3, c); px(U, x + 7, y + 13, 2, 2, c);
    px(U, x + 6, y + 4, 4, 5, UC.hi);
  } else if (kind === 'coin') {
    px(U, x + 2, y + 2, 12, 12, UC.ink); px(U, x + 3, y + 3, 10, 10, c); px(U, x + 5, y + 5, 6, 6, UC.brass2); px(U, x + 7, y + 6, 2, 4, UC.hi);
  }
}
/* 墓窟漂浮余烬 */
function uiEmbers(T, n, area) {
  const H = area || CFG.H;
  for (let i = 0; i < n; i++) {
    const sp = 12 + (i % 5) * 6;
    const yy = ((i * 97 - T * sp) % H + H) % H;
    const xx = ((i * 53 + Math.sin(T * 0.9 + i) * 12) % CFG.W + CFG.W) % CFG.W;
    const big = i % 4 === 0;
    const a = (0.25 + 0.35 * (0.5 + 0.5 * Math.sin(T * 3 + i))).toFixed(2);
    px(U, Math.round(xx), Math.round(yy), big ? 2 : 1, big ? 2 : 1, i % 3 ? 'rgba(235,179,75,' + a + ')' : 'rgba(224,60,49,' + a + ')');
  }
}
/* 全屏地牢背景：暗化墓室石壁 + 暗角 + 余烬 */
function uiBackdrop(T, tint) {
  U.fillStyle = UC.deep; U.fillRect(0, 0, CFG.W, CFG.H);
  U.save(); U.globalAlpha = 0.30; U.imageSmoothingEnabled = false;
  const off = Math.round((T * 3) % 180);
  for (let y = -180; y < CFG.H + 180; y += 180) for (let x = 0; x < CFG.W; x += 180) U.drawImage(BG, x, y + off, 180, 180);
  U.restore();
  const g = U.createRadialGradient(CFG.W / 2, CFG.H * 0.40, 40, CFG.W / 2, CFG.H * 0.5, 430);
  g.addColorStop(0, tint || 'rgba(70,22,16,0.10)'); g.addColorStop(0.6, 'rgba(8,6,9,0.62)'); g.addColorStop(1, 'rgba(3,2,4,0.95)');
  U.fillStyle = g; U.fillRect(0, 0, CFG.W, CFG.H);
  uiEmbers(T, 18);
}
/* 通用哥特按钮 */
function uiButton(x, y, w, h, o) {
  const c = o.c || UC.brass;
  uiFrame(x, y, w, h, { fill: o.fill || 'rgba(22,16,20,0.95)', accent: c, top: o.top === false ? null : c, hot: o.hot });
  px(U, x + 6, y + 7, 2, h - 14, hexA(c, 0.85));
  px(U, x + 9, y + 7, 1, h - 14, hexA(c, 0.30));
  const tx = x + (o.icon ? 46 : 18);
  if (o.icon) o.icon(x + 27, y + h / 2);
  const right = x + w - (o.key ? 40 : 22);
  if (o.label && o.sub) {
    uiTrack(tx, y + 15, o.label, 7, hexA(c, 0.95), 'left', 1.2);
    uiText(tx, y + h / 2 + 6, o.title, o.size || 14, UC.hi);
    uiText(tx, y + h - 9, o.sub, 9.5, UC.mut);
  } else if (o.sub) {
    uiText(tx, y + h / 2 - 1, o.title, o.size || 14, UC.hi);
    uiText(tx, y + h / 2 + 13, o.sub, 9.5, UC.mut);
  } else if (o.label) {
    uiTrack(tx, y + 15, o.label, 7, hexA(c, 0.95), 'left', 1.2);
    uiText(tx, y + h - 11, o.title, o.size || 14, UC.hi);
  } else {
    uiText(tx, y + h / 2 + 5, o.title, o.size || 14, UC.hi);
  }
  if (o.key) uiKeycap(x + w - 34, y + h / 2 - 10, 24, 20, o.key, o.key.length > 2 ? 7.5 : 9, c);
  else if (o.chev !== false) uiChevron(right + 6, y + h / 2, c, 1);
}

/* ---------- HUD ---------- */
/* 首局分段教学条：一次只显示当前一步，完成操作自动推进 */
function drawTutorial() {
  if (!S.tut || !S.tut.on) return;
  const st = TUT_STEPS[S.tut.step];
  if (!st) return;
  const y = 118, h = 38;
  uiFrame(M, y, CFG.W - M * 2, h, { fill: 'rgba(14,10,13,0.94)', accent: PAL.cyan, top: PAL.cyan, hot: true });
  for (let i = 0; i < TUT_STEPS.length; i++) {
    const dx = M + 13 + i * 9;
    px(U, dx - 2, y + 8, 6, 6, i < S.tut.step ? '#2f6b4a' : UC.ink);
    px(U, dx - 1, y + 9, 4, 4, i < S.tut.step ? '#7bd88f' : (i === S.tut.step ? PAL.cyan : UC.iron2));
  }
  uiTrack(CFG.W - M - 8, y + 12, '完成即收', 6.5, UC.mut, 'right', 0.6);
  uiText(M + 10, y + 29, st.title, 11, PAL.cyan);
  uiText(M + 62, y + 29, IN.touch ? st.touch : st.key, 12.5, UC.parch);
  if (!S.collapseOn) uiTrack(CFG.W - M - 8, y + 29, '崩落暂停', 6.5, PAL.green, 'right', 0.6);
}
function drawHUD() {
  const tg = U.createLinearGradient(0, 0, 0, 110);
  tg.addColorStop(0, 'rgba(5,4,6,0.88)'); tg.addColorStop(1, 'rgba(5,4,6,0)');
  U.fillStyle = tg; U.fillRect(0, 0, CFG.W, 110);
  const bg2 = U.createLinearGradient(0, CFG.H - 100, 0, CFG.H);
  bg2.addColorStop(0, 'rgba(5,4,6,0)'); bg2.addColorStop(1, 'rgba(5,4,6,0.82)');
  U.fillStyle = bg2; U.fillRect(0, CFG.H - 100, CFG.W, 100);

  /* 左上：血瓶生命铭牌 */
  const low = P.hp <= CFG.hpMax * 0.3;
  uiFrame(10, 10, 170, 64, { fill: 'rgba(14,10,13,0.88)', accent: low ? PAL.red : UC.brass });
  uiFlask(27, 38, P.hp / CFG.hpMax, low);
  const hp = Math.max(0, Math.round(P.hp));
  const hpW = uiNum(46, 31, String(hp), 19, low ? PAL.gold : UC.parch, 'left', '700');
  U.font = '600 9px ' + UIN; U.fillStyle = UC.mut; U.fillText('/ ' + CFG.hpMax, 46 + hpW + 4, 31);
  if (S.emberShield) uiTag(172, 16, '圣盾', 'rgba(110,76,30,0.9)', PAL.gold, 7.5, 4, 'right');
  const trail = P.hpTrail !== undefined ? Math.max(P.hp, P.hpTrail) : P.hp;
  uiVial(46, 38, 122, 8, P.hp / CFG.hpMax, trail / CFG.hpMax, low ? 'low' : null);
  const need = P.lv < GROW.cap ? LV_XP[P.lv - 1] : 1;
  uiSeg(46, 53, 122, 3, Math.min(1, S.xp / need), PAL.cyan, 8, '#0d1514');
  uiTrack(16, 68, '阶 ' + P.lv, 8, PAL.cyan, 'left', 1.0);
  U.font = '600 8px ' + UIN; U.fillStyle = UC.mut; U.textAlign = 'right';
  U.fillText('魂 ' + S.xp + '/' + need, 168, 68); U.textAlign = 'left';

  /* 顶栏暂停：铁扣铭牌 */
  const pbx = 188, pby = 16, pbw = 60, pbh = 24;
  uiFrame(pbx, pby, pbw, pbh, { fill: 'rgba(20,14,18,0.92)', accent: UC.brass, double: false });
  px(U, pbx + 10, pby + 7, 4, 10, UC.ink); px(U, pbx + 16, pby + 7, 4, 10, UC.ink);
  px(U, pbx + 11, pby + 8, 2, 8, PAL.gold); px(U, pbx + 17, pby + 8, 2, 8, PAL.gold);
  uiText(pbx + 26, pby + 16, '暂停', 9.5, UC.parch);
  hitBox(pbx, pby, pbw, pbh, () => setPaused(true));
  if (!IN.touch) uiTrack(pbx + pbw / 2, pby + pbh + 11, 'ESC', 6.5, UC.mut, 'center', 1.1);

  /* 右上：哥特尖拱层数纹章 */
  const fl = (S.arena && S.arena.active && !S.training) ? S.arena.floor : Math.max(0, Math.floor(-P.y / CFG.FH));
  const fx0 = 282, fy0 = 14, fw0 = 64, fh0 = 60;
  for (let i = 0; i < 8; i++) px(U, fx0 + fw0 / 2 - 4 - i * 3, fy0 - 2 + i, 8 + i * 6, 1, UC.ink);
  for (let i = 1; i < 8; i++) px(U, fx0 + fw0 / 2 - 3 - i * 3, fy0 - 1 + i, 6 + i * 6, 1, UC.iron2);
  uiFrame(fx0, fy0 + 6, fw0, fh0 - 6, { fill: 'rgba(14,10,13,0.9)', accent: UC.brass });
  px(U, fx0 + fw0 / 2 - 1, fy0 + 1, 3, 3, PAL.gold);
  uiTrack(fx0 + fw0 / 2, fy0 + 20, '魔 塔', 7, UC.mut, 'center', 1.5);
  uiNum(fx0 + fw0 / 2, fy0 + 48, String(fl), fl >= 100 ? 22 : 28, UC.parch, 'center', '700');
  uiText(fx0 + fw0 / 2, fy0 + 60, '层', 7.5, UC.brass, 'center');
  if (S.collapseOn) {
    const d = Math.max(0, Math.ceil((S.collapseY - (P.y + P.h / 2)) / CFG.FH));
    const hot = d <= 2;
    const pulse = 0.72 + 0.28 * Math.sin(S.frames * 0.3);
    uiTag(fx0 + fw0, 80, '崩塌 ▼' + d + '层', hot ? 'rgba(170,30,26,' + pulse.toFixed(2) + ')' : 'rgba(40,24,26,0.94)', hot ? UC.hi : UC.bone, 8, 5, 'right');
  }
  if (S.mode === 'limited') uiTag(fx0 + fw0, 80, '沙漏 ' + Math.max(0, S.timer).toFixed(0) + 's', 'rgba(30,70,62,0.94)', UC.hi, 8, 5, 'right');
  if (S.mode === 'daily') uiTrack(fx0 + fw0, 92, '今日之塔 ' + dailyParts().str, 6.5, PAL.gold, 'right', 0.8);

  /* 符文镶槽与连击 */
  const cap = CFG.runeSlots || 2;
  const fxR = 46 + cap * 22 + 4;
  const rW = Math.min(160, Math.max(150, fxR + 46 - 10));
  uiFrame(10, 86, rW, 28, { fill: 'rgba(14,10,13,0.78)', accent: PAL.violet, double: false });
  uiTrack(17, 104, '符文', 8, PAL.violet, 'left', 1.0);
  for (let i = 0; i < cap; i++) {
    const x = 46 + i * 22, y = 91;
    px(U, x - 1, y - 1, 20, 20, UC.ink);
    px(U, x, y, 18, 18, '#191219');
    px(U, x, y, 18, 1, 'rgba(244,236,220,0.08)');
    const id = P.runes[i];
    if (id) {
      px(U, x + 3, y + 3, 12, 12, 'rgba(176,124,240,0.28)');
      uiText(x + 9, y + 13, RUNE_NAME[id][0], 9, PAL.violet, 'center');
    } else { px(U, x + 8, y + 7, 2, 4, UC.iron2); px(U, x + 6, y + 9, 6, 1, UC.iron2); }
  }
  if (P.furyT > 0) uiTag(fxR, 92, '战意 +40% ' + Math.ceil(P.furyT) + 's', 'rgba(120,40,24,0.95)', UC.parch, 7.5, 4);
  else if (S.combo > 1) uiTag(fxR, 92, '连 ×' + comboMult().toFixed(1) + ' ' + S.combo, 'rgba(120,80,24,0.95)', UC.parch, 7.5, 4);
  else {
    px(U, fxR, 98, 5, 5, UC.ink); px(U, fxR + 1, 99, 3, 3, P.dodgeCd <= 0 ? PAL.cyan : UC.stone);
    uiText(fxR + 8, 104, P.dodgeCd <= 0 ? '闪 就绪' : '闪 ' + P.dodgeCd.toFixed(1), 7.5, P.dodgeCd <= 0 ? PAL.cyan : UC.mut);
  }
  drawTutorial();
  /* 战祭坛：世界坐标锚定的可读提示；靠近时可点/按 F 自愿开战 */
  if (S.pact && S.pact.state !== 'done' && !S.training) {
    const ax = Math.round(S.pact.x), ay = sy(S.pact.y - 42);
    if (ay > 92 && ay < CFG.H - 140) {
      if (S.pact.state === 'idle') {
        const near = pactNear();
        uiTag(ax, ay - 20, '战 祭 坛', 'rgba(40,16,12,0.94)', PAL.gold, 8, 6, 'center');
        uiTag(ax, ay - 2, near ? (IN.touch ? '点此开战 · 逃上两层即放弃' : 'F 开战 · 逃上两层即放弃') : '绕开保命 / 开战换成长',
          near ? 'rgba(80,16,20,0.94)' : 'rgba(24,16,20,0.90)', near ? UC.parch : UC.mut, 6.5, 5, 'center');
        if (near) hitBox(ax - 48, ay - 22, 96, 44, activatePact);
      } else {
        uiTag(ax, ay - 8, '战祭 ' + S.pact.left + ' 只 · 崩落暂停', 'rgba(80,16,20,0.94)', UC.parch, 8, 6, 'center');
      }
    }
  }

  /* 镇楼 Boss 悬赏血条与封锁限时倒计时 */
  if (S.boss && !S.boss.dead) {
    const b = S.boss, meta = BOSS_META[b.bkind] || BOSS_META.colossus;
    const bx = 182, bw = 156, act = S.arena && S.arena.active;
    uiFrame(bx - 6, 100, bw + 12, act ? 58 : 36, { fill: 'rgba(16,8,10,0.9)', accent: meta.c, top: meta.c });
    uiSkull(bx + 4, 113, meta.c, 1);
    uiText(bx + 14, 115, (b.phase >= 2 ? '狂 · ' : '') + meta.title, 8.5, meta.c);
    const bTrail = b.hpTrail !== undefined ? Math.max(b.hp, b.hpTrail) : b.hp;
    uiVial(bx, 121, bw - 4, 7, b.hp / b.max, bTrail / b.max, null);
    U.font = '700 7px ' + UIN; U.fillStyle = UC.bone; U.textAlign = 'right';
    U.fillText(Math.max(0, Math.round(b.hp)) + ' / ' + b.max, bx + bw, 115); U.textAlign = 'left';
    if (act) {
      const tl = Math.max(0, S.arena.timeLeft), tm = S.arena.timeMax || 30;
      const urgent = tl <= 8;
      const tCol = urgent ? ((S.frames >> 2) % 2 ? UC.hi : PAL.red) : PAL.gold;
      uiTrack(bx, 145, '封印 · 限时讨伐', 7, urgent ? PAL.red : UC.mut, 'left', 1.0);
      uiNum(bx + bw, 146, tl.toFixed(1) + 's', 11, tCol, 'right', '700');
      uiSeg(bx, 150, bw - 4, 3, tl / tm, urgent ? PAL.red : PAL.gold, 10);
    }
  } else if (S.bossPenaltyT > 0) {
    uiFrame(176, 100, 168, 24, { fill: 'rgba(48,10,12,0.9)', accent: PAL.red, double: false });
    uiText(184, 116, '超时反噬 · 崩落加速 ' + S.bossPenaltyT.toFixed(0) + 's', 8, PAL.red);
  }

  /* 区域规则 / Boss 封门：羊皮卷横幅 */
  if (S.banner) {
    const b = S.banner, by = (S.arena && S.arena.active ? 168 : (S.boss && !S.boss.dead ? 146 : 124)) + (S.tut && S.tut.on ? 42 : 0);
    const bc = b.c || PAL.violet;
    uiFrame(M, by, CFG.W - M * 2, 56, { fill: 'rgba(14,9,11,0.92)', accent: bc, top: bc, hot: true });
    uiSkull(M + 18, by + 30, bc, 1.2);
    uiTrack(M + 34, by + 16, (b.boss ? '镇楼封印 · 第 ' : '诅咒降临 · 第 ') + b.floor + ' 层', 7.5, b.boss ? PAL.gold : UC.mut, 'left', 1.2);
    uiText(M + 34, by + 36, b.text, 15, bc);
    uiText(M + 34, by + 50, b.mech, 8.5, UC.bone);
  }

  /* 右侧铁链深度尺（骷髅标记下一尊镇楼 Boss） */
  const rx = 346, ry = 170, rh = CFG.H - 282;
  const span = 26;
  const yFor = f => ry + rh * Math.min(1, Math.max(0, (f - (pfNow() - 6)) / span));
  for (let yy = ry; yy < ry + rh; yy += 6) {
    const odd = ((yy - ry) / 6) % 2;
    px(U, rx + (odd ? 1 : 0), yy, odd ? 4 : 6, 5, UC.ink);
    px(U, rx + 1 + (odd ? 1 : 0), yy + 1, odd ? 2 : 4, 3, UC.iron2);
  }
  const nextBossF = Math.max(CFG.bossEvery, Math.ceil(Math.max(1, pfNow()) / CFG.bossEvery) * CFG.bossEvery);
  if (nextBossF <= pfNow() + span - 6) uiSkull(rx + 3, Math.round(yFor(nextBossF)), PAL.red, 1);
  if (S.collapseOn) {
    const cy = yFor(Math.max(0, Math.floor(-S.collapseY / CFG.FH)));
    U.fillStyle = 'rgba(170,30,26,0.35)'; U.fillRect(rx - 1, cy, 8, Math.max(0, ry + rh - cy));
    px(U, rx - 3, Math.round(cy) - 1, 12, 3, UC.ink); px(U, rx - 2, Math.round(cy), 10, 1, PAL.red);
  }
  const py0 = Math.round(yFor(pfNow()));
  px(U, rx - 9, py0 - 3, 8, 7, UC.ink);
  px(U, rx - 8, py0 - 2, 5, 5, PAL.gold); px(U, rx - 3, py0 - 1, 2, 3, PAL.gold); px(U, rx - 7, py0 - 1, 2, 1, UC.hi);

  /* 金币 / 积分 */
  uiIcon(M - 2, CFG.H - 85, 16, PAL.gold, 'coin');
  uiNum(M + 18, CFG.H - 72, String(S.coins), 15, PAL.gold, 'left', '700');
  uiTrack(CFG.W - M, CFG.H - 84, '功 绩', 7, UC.mut, 'right', 1.4);
  uiNum(CFG.W - M, CFG.H - 68, String(S.score), 14, UC.parch, 'right', '700');

  /* 双武器铁匣 */
  const wy = CFG.H - 54, ww = 160, wh = 40;
  const strip = (x, label, key, active, c) => {
    const W = WEAP[key];
    uiFrame(x, wy, ww, wh, { fill: active ? 'rgba(24,16,20,0.97)' : 'rgba(16,12,15,0.80)', accent: active ? c : UC.iron2, top: active ? c : null, hot: active });
    px(U, x + 5, wy + 5, 30, 30, UC.ink);
    px(U, x + 6, wy + 6, 28, 28, active ? '#1f161b' : '#151014');
    drawWeaponGlyph(U, x + 21, wy + 20, key, active ? c : UC.stone);
    if (active && P.atkCd > 0 && W && W.cd) {
      const k = Math.min(1, P.atkCd / W.cd);
      U.fillStyle = 'rgba(5,4,6,0.62)'; U.fillRect(x + 6, wy + 6, 28, Math.round(28 * k));
    }
    /* 就绪/出手条：出手瞬间满格发亮，冷却期间回填，填满=可再次出手；避免把冷却误读成失灵 */
    if (active && W && W.cd) {
      const busy = P.anim.atk > 0;
      const ready = P.atkCd <= 0 ? 1 : Math.max(0, Math.min(1, 1 - P.atkCd / W.cd));
      px(U, x + 6, wy + 36, 28, 2, UC.ink);
      const bw = Math.max(1, Math.round(28 * (busy ? 1 : ready)));
      px(U, x + 6, wy + 36, bw, 2, busy ? c : (P.atkCd <= 0 ? '#7bd88f' : UC.mut));
      if (busy) { px(U, x + 5, wy + 5, 30, 1, c); px(U, x + 5, wy + 34, 30, 1, c); }
    }
    uiTrack(x + 42, wy + 14, label, 7, active ? c : UC.mut, 'left', 1.2);
    /* 常驻操作提示：近战点按 / 远程长按，不再只写伤害 */
    uiTrack(x + ww - 9, wy + 14, W.slot === 'melee' ? '点按挥击' : '长按连射', 7, active ? UC.parch : UC.stone, 'right', 0.8);
    uiText(x + 42, wy + 30, W.name, 11, active ? UC.parch : UC.mut);
    uiNum(x + ww - 9, wy + 30, String(Math.round(W.dmg * P.atkMul)), 15, active ? c : UC.stone, 'right', '700');
  };
  strip(M, '壹 · 近战', P.weapon.melee, P.slot === 0, PAL.red);
  strip(M + ww + 8, '贰 · 远程', P.weapon.ranged, P.slot === 1, PAL.cyan);

  drawHUDToasts();

  drawFloatTouch();
}
/* 飘字 / 暗区 / 触摸键：HUD 与训练场共用 */
function drawFloatTouch() {
  for (const q of S_FLOAT) {
    U.globalAlpha = Math.min(1, q.t / 0.35);
    const fx = Math.round(q.x) - 8, fy = sy(q.y);
    U.font = '700 11px ' + UIN; U.fillStyle = 'rgba(5,4,6,0.95)';
    U.fillText(q.txt, fx - 1, fy); U.fillText(q.txt, fx + 1, fy); U.fillText(q.txt, fx, fy - 1); U.fillText(q.txt, fx, fy + 1);
    U.fillStyle = q.c; U.fillText(q.txt, fx, fy);
    U.globalAlpha = 1;
  }

  if (S.dark) {
    const g = U.createRadialGradient(P.x, sy(P.y) - 16, 36, P.x, sy(P.y) - 16, 190);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.86)');
    U.fillStyle = g; U.fillRect(0, 0, CFG.W, CFG.H);
  }

}


/* ---------- UI 内部图腾与层数辅助 ---------- */

function pfNow() { return Math.max(0, Math.floor(-P.y / CFG.FH)); }

function drawWeaponGlyph(g, x, y, key, c) {
  x = Math.round(x); y = Math.round(y);
  if (key === 'knife') {
    px(g, x - 8, y + 1, 12, 4, PAL.ink);
    px(g, x - 7, y + 2, 10, 2, c); px(g, x - 9, y + 1, 4, 2, PAL.hi);
    px(g, x + 2, y, 2, 6, PAL.gold2); px(g, x + 4, y + 2, 4, 2, '#6b442a');
  } else if (key === 'long') {
    px(g, x - 11, y + 2, 20, 4, PAL.ink);
    px(g, x - 10, y + 3, 18, 2, c); px(g, x - 12, y + 2, 6, 2, PAL.hi);
    px(g, x + 6, y, 2, 7, PAL.gold); px(g, x + 8, y + 2, 4, 2, PAL.red);
  } else if (key === 'hammer') {
    px(g, x - 2, y - 5, 4, 12, PAL.ink); px(g, x - 1, y - 4, 2, 10, '#7a4b2c');
    px(g, x - 8, y - 7, 16, 7, PAL.ink); px(g, x - 7, y - 6, 14, 5, c);
    px(g, x - 5, y - 6, 10, 2, PAL.hi); px(g, x - 1, y - 5, 2, 3, PAL.gold);
  } else if (key === 'crossbow') {
    px(g, x - 8, y - 2, 16, 4, PAL.ink); px(g, x - 7, y - 1, 13, 2, '#8b5732');
    px(g, x + 1, y - 6, 3, 12, c); px(g, x - 5, y - 5, 2, 10, PAL.stone3);
    px(g, x + 5, y - 1, 4, 2, PAL.hi);
  } else if (key === 'ember') {
    /* 烬铁巨剑：暗黑哥特恶魔重剑（八角暗金配重 + 恶魔角十字铁格 + 焦炭黑铁阔刃 + 贯穿熔岩金光血槽 + 锯齿剑背） */
    px(g, x + 5, y + 5, 5, 5, PAL.ink); px(g, x + 6, y + 6, 3, 3, PAL.gold2); px(g, x + 7, y + 7, 1, 1, PAL.hi);
    seg(g, x + 6, y + 6, x + 1, y + 1, 4, PAL.ink);
    seg(g, x + 6, y + 6, x + 1, y + 1, 2, '#4a251a');
    /* 恶魔角十字护手 */
    seg(g, x - 3, y + 6, x + 5, y - 2, 5, PAL.ink);
    seg(g, x - 2, y + 5, x + 4, y - 1, 3, PAL.gold2);
    px(g, x - 4, y + 7, 2, 2, PAL.gold); px(g, x + 5, y - 3, 2, 2, PAL.gold);
    px(g, x + 1, y + 1, 3, 3, PAL.ink); px(g, x + 2, y + 2, 1, 1, PAL.red); /* 余烬之核 */
    /* 阔刃大剑身 */
    seg(g, x + 1, y + 1, x - 11, y - 11, 11, PAL.ink);
    seg(g, x + 1, y + 1, x - 10, y - 10, 7, PAL.stone2);
    seg(g, x - 1, y - 1, x - 10, y - 10, 3, PAL.stone3);
    /* 贯穿剑脊的熔金血槽 */
    seg(g, x, y, x - 9, y - 9, 3, '#8e2a18');
    seg(g, x, y, x - 8, y - 8, 1, PAL.gold);
    px(g, x - 4, y - 4, 1, 1, PAL.hi);
    /* 锯齿剑背缺口 */
    px(g, x - 7, y - 2, 2, 2, PAL.ink);
    px(g, x - 3, y - 7, 2, 2, PAL.ink);
    /* 剑尖收尖锋芒 */
    px(g, x - 12, y - 12, 3, 3, PAL.ink); px(g, x - 11, y - 11, 1, 1, PAL.hi);
  } else {
    px(g, x - 5, y - 5, 10, 10, PAL.ink);
    px(g, x - 4, y - 4, 8, 8, c); px(g, x - 2, y - 2, 4, 4, PAL.hi);
    px(g, x - 6, y - 1, 1, 2, PAL.cyan); px(g, x + 5, y - 1, 1, 2, PAL.cyan);
  }
}

function drawMonGlyph(g, x, y, kind, c) {
  x = Math.round(x); y = Math.round(y);
  if (kind === 'moth') {
    px(g, x - 10, y - 5, 7, 7, PAL.ink); px(g, x + 3, y - 5, 7, 7, PAL.ink);
    px(g, x - 9, y - 4, 6, 5, c); px(g, x + 3, y - 4, 6, 5, c);
    px(g, x - 2, y - 5, 4, 9, PAL.hi); px(g, x - 7, y - 3, 2, 2, PAL.cyan); px(g, x + 5, y - 3, 2, 2, PAL.cyan);
  } else if (kind === 'bomber') {
    px(g, x - 9, y - 3, 6, 3, c); px(g, x + 3, y - 3, 6, 3, c);
    px(g, x - 5, y - 5, 10, 10, PAL.ink);
    px(g, x - 4, y - 4, 8, 8, PAL.red); px(g, x - 2, y - 2, 4, 4, PAL.gold); px(g, x - 1, y - 1, 2, 2, PAL.hi);
  } else if (kind === 'raider') {
    px(g, x - 4, y - 6, 2, 3, PAL.gold); px(g, x + 2, y - 6, 2, 3, PAL.gold);
    px(g, x - 6, y - 4, 12, 9, PAL.ink);
    px(g, x - 5, y - 3, 10, 7, c); px(g, x - 3, y - 1, 6, 2, PAL.red); px(g, x + 3, y + 1, 8, 2, PAL.hi);
  } else if (kind === 'grenadier') {
    px(g, x - 6, y - 4, 10, 9, PAL.ink);
    px(g, x - 5, y - 3, 8, 7, c); px(g, x + 3, y - 6, 5, 5, PAL.gold2);
    px(g, x + 4, y - 8, 3, 2, PAL.red); px(g, x + 5, y - 8, 1, 1, PAL.hi);
  } else {
    px(g, x - 2, y - 7, 4, 2, c); px(g, x - 2, y + 5, 4, 2, c);
    px(g, x - 7, y - 2, 2, 4, c); px(g, x + 5, y - 2, 2, 4, c);
    px(g, x - 5, y - 5, 10, 10, PAL.ink);
    px(g, x - 4, y - 4, 8, 8, PAL.red); px(g, x - 1, y - 2, 2, 4, PAL.gold);
  }
}

/* ---------- 菜单：血月魔塔动态场景 ---------- */
function drawMenuTower(T) {
  const cxT = 262;
  /* 远山与墓园剪影 */
  U.fillStyle = '#0e090d';
  U.beginPath(); U.moveTo(0, 330);
  for (let x = 0; x <= CFG.W; x += 20) U.lineTo(x, 316 - Math.abs(Math.sin(x * 0.021 + 1.3)) * 34 - (x > 180 ? 10 : 0));
  U.lineTo(CFG.W, 380); U.lineTo(0, 380); U.closePath(); U.fill();
  /* 塔身主体（月光冷边 + 背光重墨） */
  const top = 104, base = 352;
  px(U, cxT - 34, top + 60, 68, base - top - 60, UC.ink);
  px(U, cxT - 32, top + 62, 64, base - top - 62, '#120c11');
  px(U, cxT - 32, top + 62, 3, base - top - 62, '#3a1a1d');
  px(U, cxT + 22, top + 62, 10, base - top - 62, '#0a070a');
  /* 砖缝 */
  for (let y = top + 70; y < base; y += 10) {
    px(U, cxT - 30, y, 52, 1, 'rgba(0,0,0,0.6)');
    for (let x = cxT - 30 + ((y / 10) % 2) * 8; x < cxT + 22; x += 16) px(U, x, y, 1, 10, 'rgba(0,0,0,0.5)');
  }
  /* 三层城垛环 */
  for (const yy of [top + 60, top + 140, top + 210]) {
    px(U, cxT - 40, yy - 2, 80, 10, UC.ink);
    px(U, cxT - 38, yy, 76, 6, '#1c1218');
    px(U, cxT - 38, yy, 76, 1, '#4a2224');
    for (let x = cxT - 38; x < cxT + 38; x += 10) { px(U, x, yy - 7, 6, 6, UC.ink); px(U, x + 1, yy - 6, 4, 4, '#1c1218'); }
  }
  /* 尖顶与避雷血晶 */
  for (let i = 0; i < 52; i++) {
    const hw = Math.round(i * 0.62);
    px(U, cxT - hw - 1, top + 6 + i, hw * 2 + 2, 1, UC.ink);
    if (hw > 1) px(U, cxT - hw, top + 6 + i, hw * 2, 1, i % 6 === 0 ? '#2a1418' : '#150d12');
    if (hw > 1) px(U, cxT - hw, top + 6 + i, 1, 1, '#4a2224');
  }
  const bp = 0.5 + 0.5 * Math.sin(T * 2.4);
  U.fillStyle = 'rgba(224,60,49,' + (0.18 + 0.18 * bp).toFixed(2) + ')';
  U.beginPath(); U.arc(cxT, top, 14 + bp * 4, 0, 7); U.fill();
  px(U, cxT - 1, top - 14, 3, 20, UC.ink); px(U, cxT - 3, top - 4, 7, 7, UC.ink); px(U, cxT - 2, top - 3, 5, 5, PAL.red); px(U, cxT - 1, top - 2, 2, 2, '#ffb09a');
  /* 窗：随机明灭的烛火 */
  const wins = [[-14, 92], [8, 92], [-4, 120], [-18, 168], [10, 176], [-6, 196], [-16, 236], [6, 248], [-4, 280], [12, 300], [-20, 316]];
  wins.forEach(([dx, dy], i) => {
    const wx = cxT + dx, wy = top + dy;
    const lit = Math.sin(T * (0.7 + i * 0.13) + i * 2.1) > -0.35;
    px(U, wx - 1, wy - 2, 7, 11, UC.ink);
    px(U, wx, wy - 1, 5, 9, lit ? '#e8a838' : '#1a1015');
    px(U, wx + 1, wy - 2, 3, 1, UC.ink);
    if (lit) {
      px(U, wx + 2, wy - 1, 1, 9, UC.ink); px(U, wx, wy + 3, 5, 1, UC.ink);
      px(U, wx, wy - 1, 2, 2, '#ffd98a');
      U.fillStyle = 'rgba(232,168,56,0.10)'; U.fillRect(wx - 5, wy - 6, 15, 19);
    }
  });
  /* 拱门大门 */
  px(U, cxT - 12, base - 30, 24, 30, UC.ink);
  px(U, cxT - 10, base - 26, 20, 26, '#2a1210');
  px(U, cxT - 6, base - 30, 12, 4, UC.ink);
  px(U, cxT - 8, base - 22, 16, 22, 'rgba(232,120,40,0.35)');
  px(U, cxT - 1, base - 24, 2, 24, UC.ink);
  /* 前景墓碑十字与枯树 */
  const graves = [[30, 350, 1], [62, 356, 0], [104, 352, 1], [150, 358, 0], [320, 352, 1], [196, 356, 1]];
  for (const [gx, gy, cross] of graves) {
    if (cross) { px(U, gx - 2, gy - 18, 5, 18, UC.ink); px(U, gx - 7, gy - 13, 15, 5, UC.ink); px(U, gx - 1, gy - 17, 3, 16, '#1a1316'); }
    else { px(U, gx - 7, gy - 14, 14, 14, UC.ink); px(U, gx - 5, gy - 16, 10, 3, UC.ink); px(U, gx - 5, gy - 13, 10, 12, '#1a1316'); px(U, gx - 5, gy - 13, 1, 12, '#3a2a2a'); }
  }
  U.strokeStyle = UC.ink; U.lineWidth = 3;
  U.beginPath(); U.moveTo(126, 360); U.lineTo(128, 300); U.lineTo(116, 276); U.moveTo(128, 312); U.lineTo(146, 290); U.lineTo(152, 270); U.moveTo(127, 296); U.lineTo(136, 284); U.stroke();
  U.lineWidth = 1.5; U.beginPath(); U.moveTo(116, 276); U.lineTo(108, 270); U.moveTo(146, 290); U.lineTo(160, 286); U.stroke();
  /* 地面 */
  px(U, 0, 356, CFG.W, 30, '#0b080a');
  for (let x = 0; x < CFG.W; x += 6) px(U, x, 354 + ((x * 7) % 4), 4, 3, '#0b080a');
}
function drawMenu() {
  const T = performance.now() / 1000;
  /* 夜空渐层 */
  const sg = U.createLinearGradient(0, 0, 0, CFG.H);
  sg.addColorStop(0, '#07050a'); sg.addColorStop(0.32, '#1c0c12'); sg.addColorStop(0.55, '#140a0e'); sg.addColorStop(0.62, '#09070a'); sg.addColorStop(1, '#050406');
  U.fillStyle = sg; U.fillRect(0, 0, CFG.W, CFG.H);
  for (let i = 0; i < 46; i++) {
    const sx0 = (i * 83 + 17) % CFG.W, sy0 = (i * 47 + 11) % 260;
    const a = 0.2 + 0.5 * (0.5 + 0.5 * Math.sin(T * 1.7 + i * 1.3));
    px(U, sx0, sy0, i % 7 === 0 ? 2 : 1, i % 7 === 0 ? 2 : 1, 'rgba(236,220,184,' + a.toFixed(2) + ')');
  }
  /* 血月 */
  const mx = 262, my = 128;
  const mg = U.createRadialGradient(mx, my, 20, mx, my, 150);
  mg.addColorStop(0, 'rgba(224,60,49,0.34)'); mg.addColorStop(0.45, 'rgba(150,30,30,0.12)'); mg.addColorStop(1, 'rgba(0,0,0,0)');
  U.fillStyle = mg; U.fillRect(0, 0, CFG.W, 330);
  U.fillStyle = '#9e2620'; U.beginPath(); U.arc(mx, my, 50, 0, 7); U.fill();
  U.fillStyle = '#c23a2c'; U.beginPath(); U.arc(mx - 6, my - 6, 44, 0, 7); U.fill();
  U.fillStyle = 'rgba(80,12,14,0.55)';
  for (const [ox, oy, r] of [[-18, -10, 9], [14, 10, 12], [-4, 22, 6], [20, -20, 5], [-26, 16, 4]]) { U.beginPath(); U.arc(mx + ox, my + oy, r, 0, 7); U.fill(); }
  U.strokeStyle = 'rgba(255,150,110,0.45)'; U.lineWidth = 1.5; U.beginPath(); U.arc(mx, my, 50, Math.PI * 1.05, Math.PI * 1.65); U.stroke();
  /* 流云横切月面 */
  for (let i = 0; i < 4; i++) {
    const cy0 = 96 + i * 22, off = ((T * (6 + i * 3) + i * 70) % 460) - 100;
    U.fillStyle = 'rgba(8,5,8,' + (0.55 - i * 0.08).toFixed(2) + ')';
    U.fillRect(Math.round(off), cy0, 120 - i * 14, 5); U.fillRect(Math.round(off) + 18, cy0 - 3, 70, 3);
  }
  /* 蝙蝠群 */
  for (let i = 0; i < 5; i++) {
    const bx = ((T * (22 + i * 5) + i * 90) % 420) - 30, by = 60 + i * 18 + Math.sin(T * 3 + i) * 6;
    const wing = Math.sin(T * 14 + i) > 0 ? -2 : 1;
    px(U, Math.round(bx) - 1, Math.round(by), 3, 2, UC.ink);
    px(U, Math.round(bx) - 5, Math.round(by + wing), 4, 1, UC.ink); px(U, Math.round(bx) + 2, Math.round(by + wing), 4, 1, UC.ink);
  }
  drawMenuTower(T);
  /* 地雾 */
  for (let i = 0; i < 5; i++) {
    const fy = 336 + i * 6, off = Math.sin(T * 0.6 + i) * 30;
    U.fillStyle = 'rgba(120,90,90,' + (0.05 + i * 0.012).toFixed(3) + ')';
    U.fillRect(Math.round(off) - 40, fy, CFG.W + 80, 8);
  }
  const dg = U.createLinearGradient(0, 360, 0, CFG.H);
  dg.addColorStop(0, 'rgba(5,4,6,0.2)'); dg.addColorStop(0.2, 'rgba(5,4,6,0.95)'); dg.addColorStop(1, '#050406');
  U.fillStyle = dg; U.fillRect(0, 360, CFG.W, CFG.H - 360);
  uiEmbers(T, 22);

  /* 顶部纪事与音频开关 */
  uiTrack(20, 28, '◆ 魔塔纪事 · 第三夜', 8, UC.brass, 'left', 1.4);
  const sndOn = S.meta.sound !== false, bgmOn0 = S.meta.bgm !== false;
  const bgmW0 = uiTag(344, 14, bgmOn0 ? '乐 · 开' : '乐 · 关', bgmOn0 ? 'rgba(52,36,22,0.95)' : 'rgba(26,20,22,0.95)', bgmOn0 ? PAL.gold : UC.mut, 8, 6, 'right');
  hitBox(344 - bgmW0 - 4, 10, bgmW0 + 8, 24, () => toggleBgm());
  const sndW = uiTag(344 - bgmW0 - 8, 14, sndOn ? '音 · 开' : '音 · 关', sndOn ? 'rgba(52,36,22,0.95)' : 'rgba(26,20,22,0.95)', sndOn ? PAL.gold : UC.mut, 8, 6, 'right');
  hitBox(344 - bgmW0 - 8 - sndW - 4, 10, sndW + 8, 24, () => toggleSound());

  /* 标题：骨白刻字 + 血痕鎏金下划 */
  const title = (s, x, y) => {
    U.font = '900 38px ' + UIS; U.textAlign = 'left';
    U.fillStyle = UC.ink; for (const [ox, oy] of [[-2, 0], [2, 0], [0, -2], [0, 3], [2, 3]]) U.fillText(s, x + ox, y + oy);
    U.fillStyle = '#5a1414'; U.fillText(s, x + 1, y + 2);
    U.fillStyle = UC.parch; U.fillText(s, x, y);
  };
  title('这个怪楼', 22, 150);
  title('有点高', 22, 196);
  px(U, 22, 208, 150, 4, UC.ink); px(U, 23, 209, 148, 2, UC.brass);
  for (const [dx, dh] of [[30, 9], [58, 14], [96, 6], [132, 11]]) {
    px(U, 22 + dx - 1, 211, 4, dh + 1, UC.ink); px(U, 22 + dx, 211, 2, dh, PAL.red2);
    px(U, 22 + dx - 1, 211 + dh - 1, 4, 3, PAL.red2);
  }
  uiText(22, 240, '这楼不给你停下来的机会', 11, UC.brass);
  uiTrack(22, 256, 'v2.72 · 神兵与出征', 7, UC.mut, 'left', 1.2);

  /* 最高层 / 印记 小铭牌 */
  uiFrame(18, 276, 86, 40, { fill: 'rgba(14,10,13,0.88)', double: false });
  uiTrack(26, 290, '最 高 层', 7, UC.mut, 'left', 1.0);
  const bw = uiNum(26, 309, String(S.meta.best), 15, UC.parch, 'left', '700');
  uiText(26 + bw + 3, 309, '层', 8, UC.brass);
  uiFrame(112, 276, 86, 40, { fill: 'rgba(14,10,13,0.88)', double: false, accent: PAL.red });
  uiTrack(120, 290, '印 记', 7, UC.mut, 'left', 1.0);
  uiNum(120, 309, String(S.meta.marks), 15, PAL.red, 'left', '700');

  /* 主行动：踏入魔塔（血蜡封印） */
  const cy = 372, ch = 62;
  const glow = 0.5 + 0.5 * Math.sin(T * 2.6);
  uiFrame(M, cy, CFG.W - M * 2, ch, { fill: 'rgba(42,12,14,0.96)', accent: PAL.gold, top: PAL.red, hot: true });
  U.fillStyle = 'rgba(224,60,49,' + (0.06 + 0.06 * glow).toFixed(3) + ')'; U.fillRect(M, cy, CFG.W - M * 2, ch);
  /* 血蜡封印章 */
  const sx = M + 34, sy0 = cy + ch / 2;
  U.fillStyle = UC.ink; U.beginPath(); U.arc(sx, sy0, 19, 0, 7); U.fill();
  U.fillStyle = '#8a1616'; U.beginPath(); U.arc(sx, sy0, 17, 0, 7); U.fill();
  U.fillStyle = '#b52520'; U.beginPath(); U.arc(sx - 2, sy0 - 2, 13, 0, 7); U.fill();
  for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; px(U, Math.round(sx + Math.cos(a) * 17) - 2, Math.round(sy0 + Math.sin(a) * 17) - 2, 4, 4, '#8a1616'); }
  px(U, sx - 1, sy0 - 9, 3, 18, '#5a0c0c'); px(U, sx - 6, sy0 - 4, 13, 3, '#5a0c0c');
  px(U, sx - 4, sy0 - 9, 9, 2, '#5a0c0c');
  uiTrack(M + 64, cy + 20, '开 始 攀 登', 7.5, PAL.gold, 'left', 1.0);
  uiText(M + 64, cy + 44, '踏入魔塔', 22, UC.parch);
  uiText(M + 168, cy + 44, '择一座塔，开始攀登', 8.5, UC.bone);
  uiChevron(CFG.W - M - 16, cy + ch / 2, PAL.gold, 1);
  hitBox(M, cy, CFG.W - M * 2, ch, () => { S.menuPage = 'select'; });

  /* 三副入口 */
  const subW = Math.floor((CFG.W - M * 2 - 12) / 3), sy1 = 448, sh = 54;
  const sub = (x, t1, t2, c, key, act, icon) => {
    uiFrame(x, sy1, subW, sh, { fill: 'rgba(18,13,16,0.95)', accent: c, top: c });
    icon(x + 18, sy1 + 24);
    uiText(x + 32, sy1 + 25, t1, 13.5, UC.parch);
    uiText(x + 32, sy1 + 40, t2, 10.5, hexA(c, 0.95));
    uiKeycap(x + subW - 20, sy1 + 33, 14, 13, key, 7, c);
    hitBox(x, sy1, subW, sh, act);
  };
  sub(M, '印记解锁', '印记 ' + S.meta.marks, PAL.red, 'U', () => { S.menuPage = 'unlock'; }, (x, y) => {
    px(U, x - 6, y - 2, 13, 9, UC.ink); px(U, x - 5, y - 1, 11, 7, '#3a2a28'); px(U, x - 3, y - 9, 7, 8, UC.ink); px(U, x - 2, y - 8, 5, 7, PAL.red); px(U, x - 1, y - 7, 1, 3, '#ff9a7c');
  });
  sub(M + subW + 6, '操作说明', '探塔秘典', UC.bone, 'H', () => { S.helpOpen = true; clearGameplayInput(); }, (x, y) => {
    px(U, x - 7, y - 7, 14, 15, UC.ink); px(U, x - 6, y - 6, 12, 13, UC.parch); px(U, x - 6, y - 6, 12, 2, '#a8916a'); px(U, x - 4, y - 2, 8, 1, '#6a5640'); px(U, x - 4, y + 1, 7, 1, '#6a5640'); px(U, x - 4, y + 4, 6, 1, '#6a5640');
  });
  sub(M + (subW + 6) * 2, '训练场', '试炼地牢', PAL.gold, 'T', () => { startTraining(); }, (x, y) => {
    px(U, x - 1, y - 9, 3, 17, UC.ink); px(U, x, y - 8, 1, 13, UC.bone); px(U, x - 5, y + 3, 11, 3, UC.ink); px(U, x - 4, y + 4, 9, 1, PAL.gold); px(U, x - 1, y + 6, 3, 4, '#7a4b2c');
  });

  /* 历代墓志 */
  const ry = 516;
  uiFrame(M, ry, CFG.W - M * 2, 56, { fill: 'rgba(14,10,13,0.92)', double: false });
  uiSkull(M + 20, ry + 30, UC.bone, 1.3);
  uiTrack(M + 36, ry + 18, '历 代 墓 志', 7.5, UC.brass, 'left', 1.0);
  uiTrack(M + 36, ry + 34, '按塔分别', 7, UC.mut, 'left', 0.6);
  uiTrack(M + 36, ry + 46, '铭刻', 7, UC.mut, 'left', 0.6);
  const recs = [['endless', '无尽之塔', PAL.cyan], ['limited', '沙漏之塔', PAL.gold], ['daily', '今日之塔', PAL.violet]];
  recs.forEach(([k, label, c], i) => {
    const x = M + 96 + i * 76;
    px(U, x - 8, ry + 10, 1, 36, UC.line);
    uiTrack(x, ry + 22, label, 7, c, 'left', 0.8);
    const v = k === 'daily' ? dailyBest() : (S.meta[modeMeta(k).best] || 0);
    const vw = uiNum(x, ry + 44, v ? String(v) : '—', 16, v ? UC.parch : UC.stone, 'left', '700');
    if (v) uiText(x + vw + 2, ry + 44, '层', 7, c);
  });
  /* 底部 */
  uiText(CFG.W / 2, 600, '← → 移动 · Z 跳 · X 攻（长按连射）· C 砸 · Shift 闪', 8, UC.mut, 'center');
  uiText(CFG.W / 2, 615, 'Q 切槽 · E 换武器 · T 试炼 · H 秘典 · Esc 暂停', 8, UC.mut, 'center');
  uiCandle(26, 632, T, 9); uiCandle(CFG.W - 28, 632, T + 1.7, 9);
}



function modeMeta(m) {
  return ({
    endless: {
      i: '01', name: '开始爬楼 · 无尽', tag: '这楼不给你停下来的机会', c: PAL.cyan, best: 'bestEndless',
      short: '崩落线 8 秒后启动 · 怪谈规则', modeLine: 'ENDLESS', seedLine: 'RUN // NO END',
      rules: [
        ['崩落线 8 秒后启动', '楼体从脚下追上来，越拖越危险'],
        ['每 10 层一条怪谈规则', '门后规则随机，层数越深越狠'],
        ['杀怪 / 爬楼双轨奖励', '击杀掉落，爬楼给分与金币'],
      ],
      note: '别在底层恋战，崩落线不等人。',
    },
    limited: {
      i: '02', name: '60 秒限时', tag: '一分钟，能爬多高', c: PAL.gold, best: 'bestLimited',
      short: '无崩落线 · 冲最高层', modeLine: '60 SEC', seedLine: 'TIMER // 60.0',
      rules: [
        ['无崩落线', '不会被楼吞掉，专心向上'],
        ['60 秒内冲最高层', '时间到即结算，按层数计分'],
        ['默认解锁攀爬', '贴墙可上，路线更自由'],
      ],
      note: '时间是唯一的敌人，向上就是分数。',
    },
    daily: (() => {
      const dp = dailyParts();
      return {
        i: '03', name: '每日怪谈', tag: '全服同一栋楼 · 北京时间零点刷新', c: PAL.violet, best: 'bestDaily',
        short: '全服同一栋楼 · 日期种子', modeLine: 'DAILY', seedLine: 'SEED // ' + dp.str,
        rules: [
          ['种子＝当天日期', dp.str + ' 固定楼体'],
          ['全服同一栋楼', '同一天同一套台阶与规则'],
          ['每天可多次挑战', '只记录当日最佳成绩'],
        ],
        note: '楼体按日期全服一致，成绩存于本机当日档案。',
      };
    })(),
  })[m] || null;
}

function drawModeIcon(kind, x, y, w, h, c, T) {
  const cx = x + w / 2;
  if (kind === 'endless') {
    const top = y + 14, bot = y + h - 16;
    px(U, cx - 26, top, 52, 1, 'rgba(176,150,110,0.22)');
    px(U, cx - 26, top, 1, bot - top, 'rgba(176,150,110,0.18)');
    px(U, cx + 25, top, 1, bot - top, 'rgba(176,150,110,0.18)');
    const step = (bot - top - 6) / 6;
    for (let i = 0; i < 6; i++) px(U, cx - 26, top + 6 + step * i, 52, 2, i === 3 ? c : 'rgba(64,48,42,0.75)');
    px(U, cx - 2, top + 6 + step * 3 - 8, 4, 8, PAL.violet);
    for (let i = 0; i < 3; i++) px(U, cx + 32, top + 8 + i * 14, 2, 6, 'rgba(72,201,176,0.55)');
    uiHatch(cx - 26, bot - 6, 52, 6, 'rgba(224,60,49,0.30)', 4, 0);
    px(U, cx - 26, bot - 6, 52, 1, PAL.red);
  } else if (kind === 'limited') {
    const cy = y + h / 2 - 2, r = 30;
    U.strokeStyle = 'rgba(176,150,110,0.28)'; U.lineWidth = 1;
    U.beginPath(); U.arc(cx, cy, r, 0, 7); U.stroke();
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2, r1 = r - 3, r2 = i % 3 === 0 ? r - 9 : r - 6;
      U.strokeStyle = i % 3 === 0 ? c : 'rgba(176,150,110,0.35)';
      U.lineWidth = i % 3 === 0 ? 2 : 1;
      U.beginPath();
      U.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      U.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
      U.stroke();
    }
    const ang = -Math.PI / 2 + ((T * 6) % 60) / 60 * Math.PI * 2;
    U.strokeStyle = c; U.lineWidth = 2;
    U.beginPath(); U.moveTo(cx, cy); U.lineTo(cx + Math.cos(ang) * (r - 12), cy + Math.sin(ang) * (r - 12)); U.stroke();
    px(U, cx - 1, cy - 1, 3, 3, c);
    uiNum(cx, cy + 18, '60', 10, c, 'center', '600');
  } else {
    const dp = dailyParts();
    const cw = 56, ch = 62, x0 = cx - 28, y0 = y + 16;
    px(U, x0, y0, cw, ch, 'rgba(24,18,22,0.8)');
    px(U, x0, y0, cw, 12, 'rgba(176,124,240,0.18)');
    px(U, x0, y0 + 12, cw, 1, PAL.violet);
    uiTrack(x0 + 4, y0 + 9, dp.mon, 5, PAL.violet, 'left', 1.0);
    uiText(x0 + cw - 4, y0 + 9, dp.dd, 7, UC.hi, 'right');
    const hi = (dp.day - 1) % 28, hr = Math.floor(hi / 7), hc = hi % 7;
    for (let r = 0; r < 4; r++) {
      for (let cc = 0; cc < 7; cc++) {
        const gx = x0 + 3 + cc * 7, gy = y0 + 18 + r * 7;
        px(U, gx, gy, 6, 6, 'rgba(64,48,42,0.38)');
        if (r === hr && cc === hc) { px(U, gx, gy, 6, 6, PAL.violet); px(U, gx + 2, gy + 2, 2, 2, UC.hi); }
      }
    }
    uiTrack(x0 + 4, y0 + 56, 'SEED ' + dp.key, 4.5, UC.mut, 'left', 0.8);
  }
}

function uiBackBtn() {
  const bx = CFG.W - 94;
  uiFrame(bx, 14, 76, 26, { fill: 'rgba(20,14,18,0.95)', double: false });
  uiChevron(bx + 14, 27, UC.brass, -1);
  uiText(bx + 26, 31, '返回', 10, UC.parch);
  hitBox(bx - 2, 12, 80, 30, () => { S.menuPage = 'home'; });
}
function uiHeader(kicker, title, sub, c) {
  uiTrack(22, 30, kicker, 8, c || UC.brass, 'left', 1.4);
  uiText(22, 72, title, 24, UC.parch);
  if (sub) uiText(22, 92, sub, 12, UC.mut);
  uiDivider(104);
}
function drawSelect() {
  const T = performance.now() / 1000;
  uiBackdrop(T);
  uiBackBtn();
  uiHeader('◆ 择 塔 而 登', '选择一座魔塔', '三座魔塔，三种诅咒，同一副身手');
  const keys = ['endless', 'limited', 'daily'];
  const roman = ['I', 'II', 'III'];
  const names = { endless: '无尽之塔', limited: '沙漏之塔', daily: '今日之塔' };
  keys.forEach((key, i) => {
    const mi = modeMeta(key);
    const x = M, y = 120 + i * 132, w = CFG.W - M * 2, h = 120;
    uiFrame(x, y, w, h, { fill: 'rgba(18,13,16,0.95)', accent: mi.c, top: mi.c });
    px(U, x + 7, y + 8, 98, h - 16, UC.ink);
    px(U, x + 8, y + 9, 96, h - 18, '#0f0b0e');
    U.fillStyle = hexA(mi.c, 0.07); U.fillRect(x + 8, y + 9, 96, h - 18);
    drawModeIcon(key, x + 6, y + 9, 100, 100, mi.c, T);
    uiNum(x + 120, y + 24, roman[i], 13, mi.c, 'left', '700');
    uiText(x + 146, y + 24, names[key], 16, UC.parch);
    uiText(x + 120, y + 42, mi.tag, 8.5, UC.bone);
    for (let j = 0; j < 3; j++) {
      const yy = y + 62 + j * 14;
      px(U, x + 120, yy - 5, 4, 4, UC.ink); px(U, x + 121, yy - 4, 2, 2, mi.c);
      uiText(x + 128, yy, mi.rules[j][0], 8, UC.mut);
    }
    uiTrack(x + 120, y + h - 9, mi.note, 6.5, UC.stone, 'left', 0.4);
    const best = S.meta[mi.best] || 0;
    uiTrack(x + w - 14, y + 20, '最 高', 7, UC.mut, 'right', 1.0);
    uiNum(x + w - 14, y + 40, best ? String(best) : '—', 14, mi.c, 'right', '700');
    uiChevron(x + w - 16, y + 84, mi.c, 1);
    hitBox(x, y, w, h, () => startRun(key));
  });
  uiDivider(530);
  uiText(CFG.W / 2, 556, '点击魔塔立即启程 · 成绩按塔分别铭刻', 8.5, UC.mut, 'center');
  uiText(CFG.W / 2, 572, '返回菜单可查看墓志与印记祭坛', 8, UC.stone, 'center');
  uiCandle(26, 620, T, 10); uiCandle(CFG.W - 28, 620, T + 2, 10);
  uiSkull(CFG.W / 2, 612, UC.stone, 1.2);
}
function drawUnlock() {
  const T = performance.now() / 1000;
  uiBackdrop(T, 'rgba(110,20,18,0.16)');
  uiBackBtn();
  uiHeader('◆ 印 记 解 锁', '永久成长', '献上攀爬换来的印记，为下一次攀登铸造起点', PAL.red);
  uiNum(252, 72, String(S.meta.marks), 22, PAL.red, 'right', '700');
  uiTrack(252, 88, '印 记', 7, UC.mut, 'right', 1.0);
  const rows = [
    ['hammer', 30, '震岳铁锤', '26 伤 · 慢速震地', PAL.red, 'hammer'],
    ['orb', 50, '湮灭法球', '14 伤 · 抛物线爆炸', PAL.cyan, 'orb'],
    ['slot', 40, '符文槽 +1', '符文上限 3', PAL.violet, 'slot'],
    ['revive', 60, '印记复生', '每局一次满血复活', PAL.gold, 'revive'],
  ];
  rows.forEach(([k, cost, label, sub, c, icon], i) => {
    const x = M, y = 120 + i * 72, w = CFG.W - M * 2, h = 60;
    const own = !!S.meta[k], afford = S.meta.marks >= cost;
    uiFrame(x, y, w, h, { fill: own ? 'rgba(20,24,18,0.95)' : 'rgba(18,13,16,0.95)', accent: own ? PAL.green : c, top: own ? PAL.green : c });
    px(U, x + 10, y + 12, 36, 36, UC.ink); px(U, x + 11, y + 13, 34, 34, '#140f12');
    uiIcon(x + 20, y + 22, 16, c, icon);
    uiText(x + 56, y + 27, label, 13, own ? PAL.green : UC.parch);
    uiText(x + 56, y + 45, sub, 8.5, UC.mut);
    if (own) uiTag(x + w - 14, y + 20, '已 铸 成', 'rgba(30,60,32,0.95)', PAL.green, 8.5, 7, 'right');
    else {
      uiNum(x + w - 14, y + 32, String(cost), 17, afford ? PAL.red : UC.stone, 'right', '700');
      uiTrack(x + w - 14, y + 48, afford ? '献 祭' : '印 记 不 足', 7, afford ? UC.bone : UC.stone, 'right', 1.0);
    }
    hitBox(x, y, w, h, () => buyMeta(k, cost, label));
  });
  uiDivider(420);
  uiText(24, 444, '印记来源：到达层数 ×2 + 击杀数 + 无伤通关 20', 8.5, UC.mut);
  uiText(24, 460, '铸成之物于下一局生效，不消耗本局金币', 8, UC.stone);
  uiButton(110, 520, 140, 36, { title: '返回主菜单', c: UC.brass, chev: false });
  hitBox(110, 520, 140, 36, () => { S.menuPage = 'home'; });
  uiCandle(26, 620, T, 10); uiCandle(CFG.W - 28, 620, T + 2, 10);
}



/* ---------- 结算：英雄陨落 · 墓志铭卷轴 ---------- */
function drawDead() {
  const T = performance.now() / 1000;
  uiBackdrop(T, 'rgba(110,18,18,0.22)');
  uiTrack(24, 30, '◆ 英雄陨落 · 魂归魔塔', 8, PAL.red, 'left', 1.4);
  uiDivider(38);

  /* 墓碑横幅：主数字＝最高到达，死亡层单独标注 */
  const best = S.finalBest !== undefined ? S.finalBest : Math.max(0, Math.floor(-P.y / CFG.FH));
  const deathFloor = S.finalDeathFloor !== undefined ? S.finalDeathFloor : best;
  const dmgInfo = S.lastDamage && S.lastDamage.reason === S.deathReason ? S.lastDamage : null;
  const srcTag = dmgInfo ? dmgInfo.srcTag : '';
  const cause = reasonText(S.deathReason, srcTag);
  const advice = deathAdvice(S.deathReason, srcTag);
  uiFrame(M, 48, CFG.W - M * 2, 88, { fill: 'rgba(22,12,15,0.96)', accent: PAL.red, top: PAL.red, hot: true });
  uiSkull(M + 24, 92, PAL.red, 1.8);
  uiTrack(M + 52, 68, '死 因 · 下 次 怎 么 改', 7, UC.mut, 'left', 1.0);
  uiText(M + 52, 88, cause, 14, PAL.red);
  uiText(M + 52, 104, '第 ' + deathFloor + ' 层 · ' + (S.frames / 60).toFixed(0) + ' 秒', 10, UC.stone);
  uiText(M + 12, 126, '建议：' + advice, 10.5, UC.parch);
  uiNum(CFG.W - M - 20, 92, String(best), 42, UC.parch, 'right', '700');
  uiText(CFG.W - M - 20, 114, '最高到达 · 层', 9, UC.brass, 'right');
  if (S.finalNewRecord && best > 0) uiTag(CFG.W - M - 16, 54, '新纪录', 'rgba(130,30,26,0.95)', UC.hi, 8, 5, 'right');

  /* 墓志铭六宫格数据表 */
  uiFrame(M, 146, CFG.W - M * 2, 156, { fill: 'rgba(16,11,14,0.94)', accent: UC.brass, double: true });
  uiTrack(M + 16, 164, '生 前 功 绩 谱', 8, UC.brass, 'left', 1.2);
  uiRule(172, M + 14, CFG.W - M * 2 - 28);
  const stats = [
    ['讨伐恶物', S.kills + ' 敌', PAL.cyan],
    ['掠得金币', S.coins + ' 金', PAL.gold],
    ['此战功绩', String(S.score), UC.parch],
    ['受击次数', (S.hitsTaken || 0) + ' 次', UC.bone],
    ['倒下次数', S.deaths + ' 次', PAL.red],
    ['塔模式', { endless: '无尽之塔', limited: '沙漏之塔', daily: '今日之塔' }[S.mode] || '无尽之塔', PAL.violet],
  ];
  stats.forEach(([k, v, c], i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = M + 16 + col * 162, y = 188 + row * 38;
    uiTrack(x, y, k, 7, UC.mut, 'left', 1.0);
    uiNum(x, y + 20, v, 14, c, 'left', '700');
    if (col === 0) px(U, x + 146, y - 2, 1, 30, UC.line);
  });

  /* 提炼印记票据 */
  const my = 312;
  uiFrame(M, my, CFG.W - M * 2, 58, { fill: 'rgba(28,12,14,0.96)', accent: PAL.red, top: PAL.gold });
  uiSkull(M + 24, my + 30, PAL.red, 1.2);
  uiTrack(M + 46, my + 20, '死 亡 提 炼 · 印 记 入 账', 7.5, PAL.gold, 'left', 1.2);
  uiText(M + 46, my + 42, '已注入印记祭坛，可在主菜单解锁神兵', 8.5, UC.bone);
  uiNum(CFG.W - M - 18, my + 38, '+' + S.runMarks, 24, PAL.red, 'right', '700');

  /* 再入轮回（主行动大按钮） */
  const ry = 380;
  uiButton(M, ry, CFG.W - M * 2, 54, {
    title: '重燃余烬 · 再战一局', sub: '以此模式重新踏入魔塔深处', label: '再 探 魔 塔', c: PAL.cyan,
    icon: (x, y) => { uiSkull(x, y, PAL.cyan, 1.1); }
  });
  hitBox(M, ry, CFG.W - M * 2, 54, () => startRun(S.mode));

  /* 返回主菜单 */
  const my2 = 444;
  uiButton(M, my2, CFG.W - M * 2, 46, {
    title: '长眠归去 · 返回标题', sub: '回到古城，查看印记祭坛与墓志', c: UC.bone,
    icon: (x, y) => { uiIcon(x - 8, y - 8, 16, UC.bone, 'shield'); }
  });
  hitBox(M, my2, CFG.W - M * 2, 46, () => { S.screen = 'menu'; S.menuPage = 'home'; });

  /* 底部装饰 */
  uiDivider(514);
  uiCandle(30, 546, T, 12);
  uiCandle(CFG.W - 32, 546, T + 1.5, 12);
  uiText(CFG.W / 2, 534, '“每一具倒在阶梯上的骸骨，都是后来者的踏脚石”', 8.5, UC.mut, 'center');
  uiText(CFG.W / 2, 550, '成绩已封存入塔楼古籍', 7.5, UC.stone, 'center');
}

/* ---------- 商店：黑市秘室 · 守门吏 ---------- */
function drawShop() {
  const T = performance.now() / 1000;
  uiBackdrop(T, 'rgba(40,24,14,0.18)');
  uiTrack(22, 28, '◆ 圣所暗室 · 守门吏', 8, PAL.gold, 'left', 1.4);
  uiNum(CFG.W - M - 6, 28, String(S.coins), 16, PAL.gold, 'right', '700');
  uiIcon(CFG.W - M - 30, 16, 16, PAL.gold, 'coin');

  uiText(22, 64, '黑市契约', 22, UC.parch);
  uiText(22, 80, '守门吏商店 · 金币购买补给', 10.5, UC.mut);
  uiDivider(92);

  /* 区域规则铭牌 */
  if (S.rule) {
    uiFrame(M, 102, CFG.W - M * 2, 50, { fill: 'rgba(26,16,22,0.94)', accent: PAL.violet, top: PAL.violet });
    uiSkull(M + 18, 128, PAL.violet, 1);
    uiTrack(M + 34, 118, '门 后 恶 兆', 7, PAL.violet, 'left', 1.0);
    uiText(M + 34, 136, S.rule.text + ' · ' + S.rule.mech, 10.5, UC.bone);
  }

  /* 货架契约：动态自适应 4 件商品（含黑市孤品·烬铁巨剑）排版，彻底消除与启程按钮重叠 */
  const offers = shopOffers();
  const offY = S.rule ? 152 : 104;
  const cardH = 50, cardGap = 54;
  offers.forEach((o, i) => {
    const y = offY + i * cardGap, w = CFG.W - M * 2;
    const afford = S.coins >= o.cost;
    const can = o.ok && afford;
    const isEmber = o.permanent;
    const block = !o.ok ? o.reason : (!afford ? '缺 金' : '');
    const accentCol = isEmber ? PAL.violet : (can ? PAL.gold : UC.stone);
    uiFrame(M, y, w, cardH, {
      fill: can ? (isEmber ? 'rgba(28,18,26,0.96)' : 'rgba(20,15,18,0.96)') : 'rgba(14,10,12,0.94)',
      accent: accentCol,
      top: can ? accentCol : null,
      hot: isEmber && can
    });
    uiKeycap(M + 10, y + 13, 22, 22, String(i + 1), 10, can ? accentCol : UC.stone);
    uiText(M + 40, y + 23, o.name, 13, can ? (isEmber ? PAL.violet : UC.parch) : UC.stone);
    uiText(M + 40, y + 39, o.desc, 9.5, o.ok ? UC.mut : UC.stone);

    uiNum(CFG.W - M - 14, y + 26, String(o.cost), 16, afford ? (isEmber ? PAL.gold : PAL.gold) : PAL.red, 'right', '700');
    uiTrack(CFG.W - M - 14, y + 41, can ? (isEmber ? '铸 入' : '购 入') : block, 6.5, can ? UC.bone : (!o.ok ? UC.mut : PAL.red), 'right', 1.0);
    hitBox(M, y, w, cardH, () => buyOffer(i));
  });

  /* 继续向上踏入黑门：根据商品条目数动态下移，严防垂直碰撞 */
  const by = offY + offers.length * cardGap + 8;
  uiButton(M, by, CFG.W - M * 2, 44, {
    title: '踏入门界 · 继续攀登', sub: '本次区域恶兆立即生效', label: '启 程', c: PAL.cyan,
    icon: (x, y) => { uiChevron(x, y, PAL.cyan, 1); }
  });
  hitBox(M, by, CFG.W - M * 2, 44, () => { S.shopOpen = false; });

  /* 底部石拱门与向上阶梯 */
  const nf = S.zone ? S.zone.to : (Math.max(0, Math.floor(-P.y / CFG.FH)) + 9);
  uiDivider(by + 62);
  uiTrack(CFG.W / 2, by + 78, '◆ 前 方 门 界 · 第 ' + nf + ' 层 ◆', 7.5, UC.brass, 'center', 1.2);
  const gx = CFG.W / 2 - 28, gy = by + 88;
  px(U, gx - 4, gy, 64, 46, UC.ink);
  px(U, gx - 2, gy + 2, 60, 44, '#1b1216');
  px(U, gx + 2, gy + 6, 52, 40, '#0a0608');
  for (let s = 0; s < 4; s++) px(U, gx + 10 + s * 4, gy + 38 - s * 7, 36 - s * 8, 3, PAL.stone2);
  px(U, CFG.W / 2 - 1, gy + 12, 2, 8, PAL.gold);
  uiText(CFG.W / 2, gy + 42, '▲', 10, PAL.gold, 'center');
  uiText(CFG.W / 2, CFG.H - 18, '数字键 1–4 购入契约 · 空格/回车 启程', 9, UC.mut, 'center');
}

/* ---------- 战利品赐福：塔罗牌式三选一 ---------- */
function drawBossReward() {
  const T = performance.now() / 1000;
  U.fillStyle = 'rgba(5,4,6,0.88)';
  U.fillRect(0, 0, CFG.W, CFG.H);
  uiEmbers(T, 16);

  const cx0 = M, cy0 = 42, cw = CFG.W - M * 2, ch = 556;
  uiFrame(cx0, cy0, cw, ch, { fill: 'rgba(14,10,13,0.98)', accent: PAL.gold, top: PAL.gold, hot: true });
  const xIn = cx0 + 14, wIn = cw - 28;

  uiTrack(xIn, 68, '◆ 镇 楼 悬 赏 讨 伐 成 功 ◆', 8, PAL.gold, 'left', 1.5);
  uiText(xIn, 98, '战利品赐福', 22, UC.parch);
  uiText(xIn, 116, '上下结界破除 · 崩落后退 4 层 · 择一永铸本局法力', 8.5, UC.bone);
  uiDivider(126, xIn, wIn);

  /* 三张塔罗牌式赐福卡片 */
  (S.bossRewards || []).forEach((card, i) => {
    const y = 138 + i * 118, h = 106;
    const ac = card.c || PAL.gold;
    uiFrame(xIn, y, wIn, h, { fill: 'rgba(22,14,18,0.97)', accent: ac, top: ac, hot: true });

    /* 塔罗徽章神龛 */
    const ix = xIn + 12, iy = y + 15;
    px(U, ix - 1, iy - 1, 40, 40, UC.ink);
    px(U, ix, iy, 38, 38, '#180f14');
    px(U, ix, iy, 38, 1, hexA(ac, 0.7));
    uiIcon(ix + 11, iy + 11, 16, ac, card.icon || 'coin');

    /* 标题与定位标签 */
    uiText(ix + 50, y + 27, card.title, 15, UC.parch);
    uiTag(ix + 50, y + 36, card.tag || 'BOSS BOON', 'rgba(40,24,28,0.95)', ac, 7.5, 5, 'left');

    /* 描述切行 */
    const d = card.desc || '';
    const cut = d.indexOf('，') > 0 ? d.indexOf('，') + 1 : 18;
    uiText(xIn + 14, y + 74, d.slice(0, cut), 8.5, UC.hi);
    if (d.length > cut) uiText(xIn + 14, y + 90, d.slice(cut), 8.5, UC.mut);

    uiKeycap(xIn + wIn - 32, y + 14, 22, 22, String(i + 1), 10, ac);
    uiChevron(xIn + wIn - 14, y + 76, ac, 1);
    hitBox(xIn, y, wIn, h, () => chooseBossReward(i));
  });

  uiDivider(500, xIn, wIn);
  uiText(xIn, 520, '命 ' + Math.round(P.hp) + '/' + CFG.hpMax + ' · 攻 ×' + P.atkMul.toFixed(2) + ' · 速 ×' + P.spdMul.toFixed(2) + ' · 金 ' + S.coins, 8, UC.mut);
  uiText(CFG.W / 2, 546, '按数字键 1 / 2 / 3 或直接点击卡牌获取赐福', 8.5, PAL.cyan, 'center');
  uiSkull(CFG.W / 2, 574, PAL.gold, 1.2);
}

/* ---------- 局内暂停：古籍封印 ---------- */
function drawPause() {
  const T = performance.now() / 1000;
  U.fillStyle = 'rgba(5,4,6,0.85)';
  U.fillRect(0, 0, CFG.W, CFG.H);
  uiEmbers(T, 14);

  const cx0 = M, cy0 = 54, cw = CFG.W - M * 2, ch = 532;
  uiFrame(cx0, cy0, cw, ch, { fill: 'rgba(15,11,14,0.98)', accent: UC.brass, top: UC.brass, hot: true });
  const xIn = cx0 + 14, wIn = cw - 28;

  uiTrack(xIn, 78, S.training ? '◆ 试炼挂起 · 动作调校' : '◆ 魔塔驻足 · 局内挂起', 8, PAL.gold, 'left', 1.4);
  uiText(xIn, 108, S.training ? '试炼暂停' : '攀登暂停', 22, UC.parch);
  const mBadge = S.training
    ? ['试炼地牢', PAL.cyan]
    : ({ endless: ['无尽之塔', PAL.cyan], limited: ['沙漏限时', PAL.gold], daily: ['今日怪谈', PAL.violet] }[S.mode] || ['魔塔之行', PAL.cyan]);
  uiTag(xIn + wIn, 94, mBadge[0], 'rgba(42,26,30,0.96)', mBadge[1], 8.5, 7, 'right');
  uiDivider(122, xIn, wIn);

  /* 四栏当前探查遥测数据 */
  const fl = (S.arena && S.arena.active && !S.training) ? S.arena.floor : Math.max(0, Math.floor(-P.y / CFG.FH));
  const st = S.trainingStats;
  const stats = S.training ? [
    ['木偶残命', String(S.dummy ? Math.max(0, Math.round(S.dummy.hp)) : 0), PAL.gold],
    ['累计伤害', String(st ? st.dmg : 0), PAL.cyan],
    ['命中数', String(st ? st.hits : 0), UC.hi],
    ['当前机关', TRAP_META[S.trainTrap] ? TRAP_META[S.trainTrap].name : '无', PAL.violet],
  ] : [
    ['当前所在', fl + ' 层', UC.parch],
    ['生命残量', Math.max(0, Math.round(P.hp)) + '/' + CFG.hpMax, P.hp > CFG.hpMax * 0.3 ? PAL.green : PAL.red],
    ['现持金币', String(S.coins), PAL.gold],
    ['斩敌 / 功', S.kills + '/' + S.score, PAL.cyan],
  ];
  const sw = Math.floor((wIn - 18) / 4);
  stats.forEach(([k, v, c], i) => {
    const sx = xIn + i * (sw + 6), sy0 = 132;
    uiFrame(sx, sy0, sw, 48, { fill: 'rgba(22,15,18,0.92)', accent: c, double: false });
    uiText(sx + 6, sy0 + 15, k, 7.5, UC.mut);
    if (S.training && i === 3) uiText(sx + 6, sy0 + 36, v, 10, c);
    else uiNum(sx + 6, sy0 + 36, v, v.length > 6 ? 11 : 13, c, 'left', '700');
  });

  /* 1. 继续魔塔行 */
  const y1 = 192, h1 = 56;
  uiButton(xIn, y1, wIn, h1, {
    title: S.training ? '重返试炼' : '继续攀登', sub: '恢复魔塔演算、崩塌追击与背景韵律', label: '解 除 封 印', c: PAL.cyan, key: 'ESC',
    icon: (x, y) => { uiChevron(x, y, PAL.cyan, 1); }
  });
  hitBox(xIn, y1, wIn, h1, () => setPaused(false));

  /* 2. 重新开局 / 清场 */
  const y2 = 258, h2 = 48;
  uiButton(xIn, y2, wIn, h2, {
    title: S.training ? '清场重置木偶' : '斩断宿命 · 重新开局', sub: S.training ? '回满血量并清除场内小怪弹幕' : '以当前模式重开一局全新魔塔', c: PAL.gold, key: 'R',
    icon: (x, y) => { uiIcon(x - 8, y - 8, 16, PAL.gold, 'revive'); }
  });
  hitBox(xIn, y2, wIn, h2, () => {
    setPaused(false, true);
    if (S.training) resetDummy(); else startRun(S.mode);
  });

  /* 3. 双列辅助：角色面板(或切换机关) + 秘典说明 */
  const y3 = 316, h3 = 48, colW = Math.floor((wIn - 8) / 2), xR = xIn + colW + 8;
  if (S.training) {
    uiButton(xIn, y3, colW, h3, { title: '轮换机关', sub: '下一个测试陷阱', c: PAL.violet, key: 'F' });
    hitBox(xIn, y3, colW, h3, () => {
      const ti = (TRAP_KINDS.indexOf(S.trainTrap) + 1) % TRAP_KINDS.length;
      setPaused(false, true);
      trainingTrap(TRAP_KINDS[ti]);
    });
  } else {
    uiButton(xIn, y3, colW, h3, { title: '角色画卷', sub: '属性·武器·符文', c: PAL.violet, key: bindingLabel('panel') });
    hitBox(xIn, y3, colW, h3, () => { S.panel = true; clearGameplayInput(); });
  }
  uiButton(xR, y3, colW, h3, { title: '操作说明', sub: '键位与身法图解', c: UC.bone, key: bindingLabel('help') });
  hitBox(xR, y3, colW, h3, () => { S.helpOpen = true; clearGameplayInput(); });

  /* 4. 双列音频：音效 + 音乐 */
  const y4 = 374, h4 = 46;
  const sndOn = S.meta.sound !== false;
  uiButton(xIn, y4, colW, h4, { title: '音效 ' + (sndOn ? '开' : '关'), sub: '击打与魔物嘶吼', c: sndOn ? PAL.green : UC.stone, key: 'M' });
  hitBox(xIn, y4, colW, h4, () => toggleSound());
  const bgmOn = S.meta.bgm !== false;
  uiButton(xR, y4, colW, h4, { title: '韵律 ' + (bgmOn ? '开' : '关'), sub: '地牢幽冥古乐', c: bgmOn ? PAL.green : UC.stone, key: 'N' });
  hitBox(xR, y4, colW, h4, () => toggleBgm());

  /* 5. 放弃返回主菜单 */
  const y5 = 430, h5 = 48;
  uiButton(xIn, y5, wIn, h5, {
    title: S.training ? '离开试炼地牢' : '舍弃本局 · 返回大殿', sub: S.training ? '结束调校，回到标题古城' : '终止本次攀登，结算现有功绩', c: PAL.red, key: 'Q',
    icon: (x, y) => { uiSkull(x, y, PAL.red, 1.1); }
  });
  hitBox(xIn, y5, wIn, h5, () => {
    if (S.training) leaveTraining();
    else { setPaused(false, true); S.screen = 'menu'; S.menuPage = 'home'; }
  });

  /* 底部提示 */
  uiDivider(494, xIn, wIn);
  uiCandle(xIn + 12, 532, T, 9);
  uiText(xIn + wIn, 514, 'ESC / 空格键随时重返战场', 8, PAL.gold, 'right');
  uiText(xIn + wIn, 528, '离开视窗时会自动挂起保全性命', 7.5, UC.mut, 'right');
  uiSkull(xIn + wIn - 8, 552, UC.stone, 1);
}

/* ---------- 角色面板：英雄羊皮古卷 ---------- */
function drawPanel() {
  const T = performance.now() / 1000;
  uiBackdrop(T, 'rgba(30,16,24,0.18)');
  uiTrack(22, 28, '◆ 英雄卷轴 · 命魂遥测', 8, PAL.cyan, 'left', 1.4);
  uiFrame(CFG.W - 86, 14, 72, 24, { fill: 'rgba(20,14,18,0.95)', double: false });
  uiText(CFG.W - 50, 30, '关闭 (P)', 8.5, UC.parch, 'center');
  hitBox(CFG.W - 90, 10, 80, 30, () => { S.panel = false; });
  uiDivider(46);

  /* 生命与位阶 */
  uiFrame(M, 56, CFG.W - M * 2, 70, { fill: 'rgba(20,14,18,0.96)', accent: UC.brass, double: true });
  uiFlask(M + 24, 92, P.hp / CFG.hpMax, P.hp <= CFG.hpMax * 0.3);
  uiTrack(M + 46, 76, '气 血 残 量', 7.5, UC.mut, 'left', 1.0);
  uiNum(M + 46, 96, P.hp + ' / ' + CFG.hpMax, 18, P.hp > CFG.hpMax * 0.3 ? PAL.green : PAL.red, 'left', '700');
  uiVial(M + 46, 103, 140, 7, P.hp / CFG.hpMax, (P.hpTrail || P.hp) / CFG.hpMax);

  const need = P.lv < GROW.cap ? LV_XP[P.lv - 1] : 1;
  uiNum(CFG.W - M - 16, 82, '第 ' + P.lv + ' 阶', 16, PAL.violet, 'right', '700');
  uiTrack(CFG.W - M - 16, 98, '凝魂 ' + S.xp + '/' + need, 7.5, UC.mut, 'right', 1.0);
  uiSeg(CFG.W - M - 100, 103, 84, 4, S.xp / need, PAL.violet, 6);

  /* 六宫格属性 */
  const cells = [
    ['利刃锋芒', '×' + P.atkMul.toFixed(2), PAL.red], ['身法神速', '×' + P.spdMul.toFixed(2), PAL.gold],
    ['魔塔当前', String(Math.max(0, Math.floor(-P.y / CFG.FH))) + ' 层', UC.parch], ['斩灭恶物', S.kills + ' 敌', PAL.cyan],
    ['囊中金币', String(S.coins), PAL.gold], ['此番功绩', String(S.score), UC.hi],
  ];
  cells.forEach(([k, v, c], i) => {
    const x = M + (i % 2) * 168, y = 138 + Math.floor(i / 2) * 44;
    uiFrame(x, y, 160, 38, { fill: 'rgba(18,12,15,0.92)', accent: c, double: false });
    uiTrack(x + 10, y + 15, k, 7, UC.mut, 'left', 1.0);
    uiNum(x + 10, y + 31, v, 13, c, 'left', '700');
  });

  /* 兵刃槽位 */
  const wy = 280;
  uiTrack(M, wy - 6, '◆ 随身神兵', 7.5, UC.brass, 'left', 1.0);
  const wrow = (x, label, key, c) => {
    uiFrame(x, wy, 160, 42, { fill: 'rgba(22,15,18,0.96)', accent: c, top: c });
    drawWeaponGlyph(U, x + 18, wy + 21, key, c);
    uiTrack(x + 38, wy + 16, label, 7, UC.mut, 'left', 1.0);
    uiText(x + 38, wy + 32, WEAP[key].name, 11, UC.parch);
    uiNum(x + 150, wy + 32, String(Math.round(WEAP[key].dmg * P.atkMul)), 14, c, 'right', '700');
  };
  wrow(M, '近战利刃', P.weapon.melee, PAL.red);
  wrow(M + 168, '远程秘武', P.weapon.ranged, PAL.cyan);

  /* 符文与崩塌 */
  const ry = 336;
  uiTrack(M, ry - 6, '◆ 秘符镶嵌', 7.5, PAL.violet, 'left', 1.0);
  uiFrame(M, ry, CFG.W - M * 2, 42, { fill: 'rgba(18,12,16,0.92)', accent: PAL.violet, double: false });
  const cap = CFG.runeSlots || 2;
  for (let i = 0; i < cap; i++) {
    const x = M + 16 + i * 44, y = ry + 8;
    px(U, x - 1, y - 1, 28, 28, UC.ink); px(U, x, y, 26, 26, '#1a111a');
    const id = P.runes[i];
    if (id) {
      px(U, x + 4, y + 4, 18, 18, 'rgba(176,124,240,0.25)');
      uiText(x + 13, y + 18, RUNE_NAME[id][0], 11, PAL.violet, 'center');
    } else {
      px(U, x + 12, y + 8, 2, 10, UC.iron2); px(U, x + 8, y + 12, 10, 2, UC.iron2);
    }
  }

  /* 崩塌深渊警示 */
  const cy = 394;
  uiFrame(M, cy, CFG.W - M * 2, 40, { fill: 'rgba(26,12,14,0.92)', accent: PAL.red, double: false });
  uiSkull(M + 16, cy + 20, PAL.red, 1);
  const col = S.collapseOn ? '深渊崩落进行中 ×' + S.collapseMul.toFixed(2) : '崩塌深渊尚未苏醒';
  uiText(M + 32, cy + 24, col + (S.freezeT > 0 ? '（玄冰冻结 ' + S.freezeT.toFixed(1) + 's）' : ''), 9.5, S.collapseOn ? PAL.red : UC.mut);
  uiText(CFG.W - M - 12, cy + 24, S.deaths + ' 次陨落', 8.5, UC.bone, 'right');

  /* 身法键位速查 */
  uiDivider(448);
  uiTrack(M, 462, '◆ 身 法 纲 要', 7.5, UC.brass, 'left', 1.0);
  const keys = [['跳跃', 'Z'], ['斩击', 'X'], ['震地', 'C'], ['闪避', 'Shift'], ['换槽', 'Q'], ['切武', 'E'], ['画卷', 'P'], ['秘典', 'H']];
  keys.forEach(([k, v], i) => {
    const x = M + (i % 4) * 82, y = 474 + Math.floor(i / 4) * 44;
    uiKeycap(x, y, 42, 22, v, 9, UC.brass);
    uiText(x + 48, y + 15, k, 9, UC.parch);
  });
  uiCandle(30, 584, T, 10);
  uiCandle(CFG.W - 32, 584, T + 1.2, 10);
  uiText(CFG.W / 2, 580, '点击任意处或按 P 键闭合画卷', 8.5, UC.mut, 'center');
}

/* ---------- 秘典：古老卷轴与身法图解 ---------- */
function drawHelp() {
  const T = performance.now() / 1000;
  uiBackdrop(T, 'rgba(40,24,16,0.18)');
  uiTrack(22, 28, '◆ 操作说明 · 键位与身法', 8, UC.brass, 'left', 1.4);
  uiText(CFG.W - M, 30, '点击任意处闭合 (H)', 9.5, UC.mut, 'right');
  uiDivider(42);

  /* 桌面键鼠 */
  uiFrame(M, 52, CFG.W - M * 2, 186, { fill: 'rgba(18,12,15,0.96)', accent: UC.brass, double: true });
  uiTrack(M + 14, 70, '端 游 身 法 · 键 盘 操 纵', 8, UC.brass, 'left', 1.2);
  uiKeycap(M + 14, 82, 38, 28, '←', 12, UC.brass);
  uiKeycap(M + 56, 82, 38, 28, '→', 12, UC.brass);
  uiText(M + 104, 100, '左右疾驰', 11, UC.parch);
  uiText(M + 156, 100, '贴墙自动挂壁滑落', 8, UC.mut);

  const acts = [['Z', '跳跃', '空中可再跳'], ['X', '攻击', '点按/长按连射'], ['C', '下砸', '空中俯冲砸地'], ['Shift', '闪避', '无敌穿过攻击']];
  acts.forEach(([k, n, s], i) => {
    const x = M + 14 + i * 78;
    uiKeycap(x, 120, 68, 28, k, 10, i % 2 ? PAL.gold : PAL.cyan);
    uiText(x, 160, n, 12.5, UC.parch);
    uiText(x, 174, s, 9.5, UC.mut);
  });
  const more = [['Q', '切槽'], ['E', '换武器'], ['P', '面板'], ['H', '说明'], ['Esc', '暂停']];
  more.forEach(([k, n], i) => {
    const x = M + 14 + i * 62;
    uiKeycap(x, 186, 54, 22, k, 8.5, UC.iron2);
    uiText(x + 27, 220, n, 9.5, UC.mut, 'center');
  });

  /* 移动掌机 / 触屏 */
  const ty0 = 248;
  uiFrame(M, ty0, CFG.W - M * 2, 260, { fill: 'rgba(18,12,15,0.96)', accent: PAL.violet, double: true });
  uiTrack(M + 14, ty0 + 18, '掌 上 触 控 · 秘 印 符 环', 8, PAL.violet, 'left', 1.2);
  uiText(M + 14, ty0 + 38, '左半屏滑动移动', 14.5, UC.parch);
  uiText(M + 14, ty0 + 56, '左右滑动控制走位', 11.5, UC.mut);
  uiText(M + 14, ty0 + 78, '右半屏四个按键', 14.5, UC.parch);
  uiText(M + 14, ty0 + 96, '跳 / 攻 / 砸 / 闪', 11.5, UC.mut);
  uiText(M + 14, ty0 + 114, '换键：单触切槽 · 双击换武器', 10.5, UC.mut);

  /* 手机模型剪影 */
  const px0 = 206, py0 = ty0 + 32, pw = 120, ph = 196;
  uiFrame(px0, py0, pw, ph, { fill: '#0a0709', accent: UC.iron2, double: false });
  px(U, px0 + pw / 2 - 12, py0 + 3, 24, 2, UC.iron2);
  px(U, px0, py0, pw / 2, ph, 'rgba(176,124,240,0.08)');
  px(U, px0 + pw / 2, py0, 1, ph, 'rgba(192,141,62,0.25)');
  uiText(px0 + pw * 0.25, py0 + 92, '滑动走位', 9, PAL.violet, 'center');
  uiTrack(px0 + pw * 0.25, py0 + 106, 'MOVE', 6, UC.mut, 'center', 1.0);

  const btn = (x, y, r, label, c) => {
    U.strokeStyle = UC.ink; U.lineWidth = 3.5; U.beginPath(); U.arc(x, y, r, 0, 7); U.stroke();
    U.strokeStyle = c; U.lineWidth = 1.5; U.beginPath(); U.arc(x, y, r, 0, 7); U.stroke();
    uiText(x, y + 3, label, 8.5, c, 'center');
  };
  btn(px0 + pw * 0.76, py0 + 44, 14, '跳', PAL.cyan);
  btn(px0 + pw * 0.58, py0 + 88, 14, '攻', PAL.red);
  btn(px0 + pw * 0.88, py0 + 88, 14, '砸', PAL.gold);
  btn(px0 + pw * 0.74, py0 + 132, 14, '闪', PAL.green);
  uiText(px0 + pw * 0.74, py0 + 172, '单触换槽', 7.5, UC.mut, 'center');

  /* 底部格言 */
  uiDivider(522);
  uiText(24, 546, '二段跳 · 蹬墙跳 · 下砸 · 连射', 11.5, UC.bone);
  uiText(24, 564, '首局分段教学；H 可随时打开说明', 10.5, UC.mut);
  uiText(24, 582, 'M 音效 · N 音乐 · F 开启战祭坛', 10.5, UC.mut);
  uiCandle(30, 620, T, 10);
  uiCandle(CFG.W - 32, 620, T + 1.4, 10);
  hitBox(0, 0, CFG.W, CFG.H, () => { closeHelp(); });
}

/* ---------- 训练场：分类工具与暂停配置 ---------- */
const TRAIN_TABS = [
  { id: 'weapons', name: '武器', c: PAL.gold },
  { id: 'monsters', name: '怪物', c: PAL.violet },
  { id: 'traps', name: '机关', c: PAL.red },
];
function cycleTrainTab() {
  S.trainToolsOpen = true;
  const i = TRAIN_TABS.findIndex(t => t.id === S.trainTab);
  S.trainTab = TRAIN_TABS[(i + 1 + TRAIN_TABS.length) % TRAIN_TABS.length].id;
  return S.trainTab;
}
function drawTrainTabs(y) {
  const gap = 6, tw = (CFG.W - M * 2 - gap * 2) / 3, th = 28;
  TRAIN_TABS.forEach((t, i) => {
    const x = M + i * (tw + gap), active = S.trainTab === t.id;
    uiFrame(x, y, tw, th, { fill: active ? 'rgba(35,22,28,0.96)' : 'rgba(16,12,15,0.88)', accent: active ? t.c : UC.iron2, top: active ? t.c : null, double: false });
    uiText(x + tw / 2, y + 19, t.name, 11, active ? UC.parch : UC.mut, 'center');
    hitBox(x, y, tw, th, () => { S.trainTab = t.id; sfx('ui'); });
  });
}
/* 一次只展开当前分类；暂停配置与局内工具区共用同一套控件 */
function drawTrainCategory(y) {
  const twKeys = trainWeaponKeys();
  const count = twKeys.length;
  const gap = 4, cw = Math.floor((CFG.W - M * 2 - gap * (count - 1)) / count);
  if (S.trainTab === 'weapons') {
    uiText(M, y, '武器 · 点击或按 1–' + count + ' 装备', 10, UC.brass);
    const rackY = y + 8, ch = 48;
    twKeys.forEach((key, i) => {
      const W = WEAP[key], x = M + i * (cw + gap);
      const active = P.weapon[W.slot] === key && P.slot === (W.slot === 'melee' ? 0 : 1);
      const c = key === 'ember' ? '#e0703c' : (W.slot === 'melee' ? PAL.red : PAL.cyan);
      uiFrame(x, rackY, cw, ch, { fill: active ? 'rgba(32,16,22,0.98)' : 'rgba(16,11,14,0.85)', accent: active ? c : UC.iron2, top: active ? c : null, hot: active });
      uiText(x + 4, rackY + 11, String(i + 1), 8, active ? c : UC.mut);
      drawWeaponGlyph(U, x + cw / 2, rackY + 14, key, active ? c : UC.mut);
      uiText(x + cw / 2, rackY + 31, W.name, 9, active ? UC.parch : UC.mut, 'center');
      uiNum(x + cw / 2, rackY + 43, String(W.dmg), 8.5, active ? c : UC.stone, 'center', '700');
      hitBox(x, rackY, cw, ch, () => trainingSelect(key));
    });
  } else if (S.trainTab === 'monsters') {
    uiText(M, y, '怪物 · 点击或按 6–0 召唤', 10, PAL.violet);
    const monY = y + 8, mh = 48, monKeys = ['6', '7', '8', '9', '0'];
    TRAIN_MONS.forEach((kind, i) => {
      const meta = MON_META[kind], x = M + i * (cw + gap);
      const liveCnt = S.monsters.filter(o => !o.dead && o.kind === kind).length;
      const hot = liveCnt > 0;
      uiFrame(x, monY, cw, mh, { fill: hot ? 'rgba(32,16,28,0.96)' : 'rgba(16,11,14,0.80)', accent: hot ? PAL.violet : UC.iron2, top: hot ? PAL.violet : null, hot });
      uiText(x + 5, monY + 11, monKeys[i], 8.5, hot ? PAL.violet : UC.mut);
      drawMonGlyph(U, x + cw / 2 + 4, monY + 15, kind, hot ? PAL.violet : UC.mut);
      uiText(x + cw / 2, monY + 31, meta.name, 10, hot ? UC.parch : UC.mut, 'center');
      uiText(x + cw / 2, monY + 43, meta.tag, 8, hot ? PAL.gold : UC.stone, 'center');
      hitBox(x, monY, cw, mh, () => trainingSpawn(kind));
    });
  } else {
    uiText(M, y, '机关 · 点击摆放，F 键轮换', 10, PAL.gold);
    const trapY = y + 8, tGap = 3, tw = Math.floor((CFG.W - M * 2 - tGap * 7) / 8), th = 48;
    TRAP_KINDS.forEach((kind, i) => {
      const tm = TRAP_META[kind], x = M + i * (tw + tGap), hot = S.trainTrap === kind;
      uiFrame(x, trapY, tw, th, { fill: hot ? 'rgba(42,22,16,0.96)' : 'rgba(16,11,14,0.80)', accent: hot ? PAL.gold : UC.iron2, top: hot ? PAL.gold : null, double: false });
      uiText(x + tw / 2, trapY + 20, tm.name, 9, hot ? UC.parch : UC.mut, 'center');
      uiText(x + tw / 2, trapY + 36, tm.tag, 8, hot ? PAL.gold : UC.stone, 'center');
      hitBox(x, trapY, tw, th, () => trainingTrap(kind));
    });
  }
}
function drawTrainingPause() {
  const T = performance.now() / 1000;
  uiBackdrop(T, 'rgba(60,28,24,0.16)');
  uiHeader('◆ 训练场配置', '更换装备与测试对象', '只展开当前分类，点击标签或按 Tab 切换', PAL.cyan);
  drawTrainTabs(124);
  drawTrainCategory(170);
  const w = CFG.W - M * 2;
  uiButton(M, 270, w, 50, { title: '返回训练', sub: 'ESC / 空格 / 点击继续', c: PAL.cyan, key: 'ESC', icon: (x, y) => uiChevron(x, y, PAL.cyan, 1) });
  hitBox(M, 270, w, 50, () => setPaused(false));
  uiButton(M, 330, w, 44, { title: '清场重置', sub: '恢复生命、木偶与场地', c: PAL.gold, key: 'R' });
  hitBox(M, 330, w, 44, () => { setPaused(false, true); resetDummy(); });
  uiButton(M, 382, w, 44, { title: '切换镇楼 Boss', sub: '进入试炼后工具区自动收起', c: PAL.red, key: 'B' });
  hitBox(M, 382, w, 44, () => { setPaused(false, true); trainingBoss(); });
  uiButton(M, 434, w, 44, { title: '操作说明', sub: '键位与身法图解', c: UC.bone, key: bindingLabel('help') });
  hitBox(M, 434, w, 44, () => { S.helpOpen = true; clearGameplayInput(); });
  uiButton(M, 486, w, 44, { title: '离开训练场', sub: '返回主菜单', c: UC.stone, key: 'Q' });
  hitBox(M, 486, w, 44, () => leaveTraining());
  uiText(CFG.W / 2, 556, 'M 音效 · N 音乐 · Tab 切换分类', 9.5, UC.mut, 'center');
  uiText(CFG.W / 2, 576, '暂停期间可安全更换配置，返回后立刻生效', 9.5, UC.bone, 'center');
}

/* ---------- 试炼地牢 HUD ---------- */
function drawTrainingHUD() {
  const bossActive = !!(S.boss && !S.boss.dead && S.arena && S.arena.active);
  const tg = U.createLinearGradient(0, 0, 0, 100);
  tg.addColorStop(0, 'rgba(5,4,6,0.92)'); tg.addColorStop(1, 'rgba(5,4,6,0)');
  U.fillStyle = tg; U.fillRect(0, 0, CFG.W, 100);

  /* 左上标题与不死保护气血 */
  uiFrame(10, 12, 172, 60, { fill: 'rgba(16,11,14,0.92)', accent: PAL.cyan, top: PAL.cyan });
  uiTrack(20, 26, bossActive ? '◆ Boss 试炼 · 限时讨伐' : '◆ 试炼地牢 · 招式校准', 7.5, PAL.cyan, 'left', 1.0);
  uiText(20, 48, bossActive ? 'Boss 试炼' : '训练场', 18, UC.parch);
  uiText(20, 64, bossActive ? '生命 ' + Math.round(P.hp) + '/' + CFG.hpMax + ' · 暂停可改配置' : '生命 ' + Math.round(P.hp) + '/' + CFG.hpMax + ' · 不死庇护', 10.5, P.hp < CFG.hpMax ? PAL.gold : UC.mut);

  /* 右上暂停与离开 */
  const px0 = 244, py0 = 14, pw0 = 46, ph0 = 24;
  uiFrame(px0, py0, pw0, ph0, { fill: 'rgba(20,14,18,0.92)', accent: UC.brass, double: false });
  uiText(px0 + pw0 / 2, py0 + 16, '暂停', 8.5, UC.parch, 'center');
  hitBox(px0, py0, pw0, ph0, () => setPaused(true));

  const ex = 296, ey = 14, ew = 50, eh = 24;
  uiFrame(ex, ey, ew, eh, { fill: 'rgba(32,10,12,0.92)', accent: PAL.red, double: false });
  uiText(ex + ew / 2, ey + 16, '离开', 8.5, PAL.red, 'center');
  hitBox(ex, ey, ew, eh, leaveTraining);

  const ry = 42, rw = 46;
  uiFrame(px0, ry, rw, 22, { fill: 'rgba(20,14,18,0.85)', accent: PAL.gold, double: false });
  uiText(px0 + rw / 2, ry + 15, 'R 清场', 7.5, PAL.gold, 'center');
  hitBox(px0, ry, rw, 22, resetDummy);

  const bbx = 296, bbw = 50;
  uiFrame(bbx, ry, bbw, 22, { fill: 'rgba(38,14,18,0.92)', accent: PAL.red, double: false });
  uiText(bbx + bbw / 2, ry + 15, 'B 试Boss', 7.5, PAL.red, 'center');
  hitBox(bbx, ry, bbw, 22, () => trainingBoss());

  /* Boss 试炼自动收起全部配置工具，只保留生命、Boss 状态、倒计时与重置入口 */
  if (!bossActive && S.dummy) {
    const bx = M, by = 76, bw = CFG.W - M * 2, bh = 58;
    uiFrame(bx, by, bw, bh, { fill: 'rgba(16,11,14,0.90)', accent: PAL.gold, top: PAL.gold });
    const m = S.dummy, st = S.trainingStats;
    const hp = Math.max(0, Math.round(m.hp)), max = m.max;
    uiText(bx + 12, by + 17, '木偶训练数据', 10.5, PAL.gold);
    uiNum(bx + bw - 12, by + 17, hp + ' / ' + max, 10.5, UC.parch, 'right', '700');
    uiSeg(bx + 12, by + 23, bw - 24, 5, m.hp / max, PAL.gold, 8);
    let dps = 0;
    if (st) {
      const win = st.time - 5;
      let sum = 0, first = st.time;
      for (const q of st.marks || []) if (q.t >= win) { sum += q.v; if (q.t < first) first = q.t; }
      if (sum > 0) dps = sum / Math.min(5, Math.max(0.5, st.time - first));
    }
    uiText(bx + 12, by + 49, '5 秒伤害 ' + dps.toFixed(1) + ' · 总伤害 ' + (st ? st.dmg : 0) + ' · 命中 ' + (st ? st.hits : 0), 9.5, UC.bone);
  }
  if (!bossActive) {
    drawTrainTabs(bossActive ? 90 : 146);
    drawTrainCategory(182);
    uiText(CFG.W / 2, 250, 'Tab 切换分类 · 暂停后展开完整配置', 9.5, UC.mut, 'center');
  }

  /* Boss 试炼：顶部紧凑血条与倒计时，不占用主要可玩区域 */
  if (bossActive) {
    const b = S.boss, meta = BOSS_META[b.bkind] || BOSS_META.colossus;
    const by0 = 80, bw0 = CFG.W - M * 2;
    uiFrame(M, by0, bw0, 46, { fill: 'rgba(16,9,12,0.94)', accent: meta.c, top: meta.c });
    uiText(M + 12, by0 + 17, meta.name + ' · Boss 试炼', 10.5, meta.c);
    uiNum(CFG.W - M - 10, by0 + 17, '倒计时 ' + Math.max(0, S.arena.timeLeft).toFixed(1) + 's', 10.5, PAL.gold, 'right', '700');
    uiNum(M + 12, by0 + 39, String(Math.max(0, Math.round(b.hp))) + ' / ' + b.max, 9.5, UC.parch, 'left', '700');
    uiSeg(M + 80, by0 + 31, bw0 - 92, 7, b.hp / b.max, meta.c, 8);
    uiText(CFG.W / 2, 142, '暂停可改配置 · R 清场 · B 切换 Boss', 10, UC.bone, 'center');
  }

  if (!IN.touch) {
    uiText(CFG.W / 2, CFG.H - 27, bossActive ? '近战斩碎弹幕 · Shift 闪避穿越攻击 · 暂停可展开配置' : 'Tab 切换分类 · ESC 完整配置 · B 试 Boss', 9.5, PAL.gold, 'center');
  }
  drawFloatTouch();
}


/* ---------- 全横屏 720×405 桌面 UI ---------- */
function uiWrapText(x, y, s, size, color, maxW, lh, maxLines) {
  uiFont(size, size >= 12 ? '700' : '');
  const lines = [];
  let line = '';
  for (const ch of String(s)) {
    const test = line + ch;
    if (line && U.measureText(test).width > maxW) { lines.push(line); line = ch; }
    else line = test;
  }
  if (line) lines.push(line);
  const out = lines.slice(0, maxLines || lines.length);
  out.forEach((t, i) => uiText(x, y + i * (lh || size + 4), t, size, color));
  return out.length;
}
function uiWideHeader(kicker, title, sub, c) {
  uiTrack(24, 28, kicker, 8.5, c || UC.brass, 'left', 1.4);
  uiText(24, 66, title, 25, UC.parch);
  if (sub) uiText(24, 86, sub, 10.5, UC.mut);
  uiDivider(98, 24, CFG.W - 48);
}
function hudTextLines(text, size, maxW, maxLines) {
  uiFont(size, size >= 12 ? '700' : '');
  const lines = [];
  let line = '', clipped = false;
  for (const ch of String(text).replace(/\s+/g, ' ')) {
    if (line && U.measureText(line + ch).width > maxW) {
      lines.push(line); line = '';
      if (lines.length === maxLines) { clipped = true; break; }
    }
    line += ch;
  }
  if (line) lines.push(line);
  if (clipped) {
    let last = lines[lines.length - 1];
    while (last && U.measureText(last + '…').width > maxW) last = last.slice(0, -1);
    lines[lines.length - 1] = last + '…';
  }
  return lines;
}
function drawHUDToasts() {
  if (!hudToastsVisible()) return;
  const wide = CFG.W >= 500, w = wide ? 200 : 148, x = CFG.W - w - 10;
  let y = wide ? (S.boss && !S.boss.dead ? 84 : 48) : (S.banner ? 226 : 164);
  for (const t of S.toasts.slice(0, TOAST_ACTIVE)) {
    const label = (t.count > 1 ? '×' + t.count + ' · ' : '') + t.txt;
    const lines = hudTextLines(label, 10, w - 18, 3), h = lines.length * 13 + 12;
    px(U, x, y, w, h, 'rgba(22,15,18,0.94)');
    px(U, x, y, 2, h, t.c || UC.brass);
    U.save(); U.beginPath(); U.rect(x + 6, y + 3, w - 12, h - 6); U.clip();
    lines.forEach((line, i) => uiText(x + 9, y + 16 + i * 13, line, 10, t.c));
    U.restore();
    t.shown = true;
    y += h + 5;
  }
}
function drawTutorialWide() {
  if (!S.tut || !S.tut.on) return;
  const st = TUT_STEPS[S.tut.step];
  if (!st) return;
  const x = 10, y = S.boss && !S.boss.dead ? 84 : 48, w = 236;
  const lines = hudTextLines(useTouch() ? st.touch : st.key, 10.5, w - 20, 3), h = 30 + lines.length * 14;
  uiFrame(x, y, w, h, { fill: 'rgba(14,10,13,0.94)', accent: PAL.cyan, top: PAL.cyan, double: false });
  uiText(x + 10, y + 17, st.title, 10.5, PAL.cyan);
  if (!S.collapseOn) uiText(x + w - 10, y + 17, '崩落暂停', 8, PAL.green, 'right');
  lines.forEach((line, i) => uiText(x + 10, y + 35 + i * 14, line, 10.5, UC.parch));
}
function drawHallSet(g) {
  const gy = sy(0);
  const mid = CFG.W / 2;
  /* 血月高窗与塔影 */
  const wx = mid - 112, wy = Math.max(14, gy - 258), ww = 224, wh = 82;
  px(g, wx - 6, wy - 6, ww + 12, wh + 12, PAL.ink);
  px(g, wx, wy, ww, wh, '#0a080d');
  px(g, wx + 4, wy + 4, ww - 8, wh - 8, 'rgba(100,28,34,0.28)');
  g.fillStyle = 'rgba(194,58,44,0.30)';
  g.beginPath(); g.arc(mid + 22, wy + 28, 22, 0, Math.PI * 2); g.fill();
  px(g, mid + 10, wy + 26, 26, 8, '#120c12');
  px(g, mid + 16, wy + 20, 18, 22, '#120c12');
  for (let x = wx + 14; x < wx + ww - 12; x += 28) px(g, x, wy + 8, 2, wh - 16, PAL.ink);
  px(g, wx, wy + wh - 6, ww, 6, PAL.ink);
  px(g, wx + 4, wy + wh - 5, ww - 8, 2, PAL.stone3);
  /* 三座拱门 */
  HALL_DOORS.forEach((d, i) => {
    const top = gy - 178, w = 104, left = Math.round(d.x - w / 2);
    const near = S.hallNear === i;
    px(g, left - 8, top - 8, w + 16, 14, PAL.ink);
    px(g, left - 5, top - 5, w + 10, 8, PAL.stone2);
    px(g, left - 4, top + 2, 7, 176, PAL.ink);
    px(g, left + w - 3, top + 2, 7, 176, PAL.ink);
    px(g, left - 3, top + 4, 3, 172, PAL.stone);
    px(g, left + w, top + 4, 3, 172, PAL.stone);
    px(g, left, top + 10, w, 170, 'rgba(8,6,10,0.88)');
    px(g, left + 8, top + 48, w - 16, 132, 'rgba(12,9,14,0.82)');
    g.fillStyle = hexA(d.c, near ? 0.18 : 0.08);
    g.fillRect(left + 8, top + 48, w - 16, 132);
    px(g, left + 8, top + 48, w - 16, 2, hexA(d.c, near ? 0.85 : 0.34));
    px(g, left + 10, gy - 4, w - 20, 4, d.c);
    px(g, left + 8, gy - 8, w - 16, 1, hexA(d.c, 0.65));
    for (let k = 0; k < 5; k++) {
      const sx = left + 16 + k * 18 + Math.sin(S.t * 1.7 + k + i) * 2;
      px(g, Math.round(sx), gy - 14 - (k % 3) * 4, 2, 2, hexA(d.c, 0.55));
    }
    px(g, left - 5, top + 2, 5, 5, PAL.gold2);
    px(g, left + w, top + 2, 5, 5, PAL.gold2);
  });
  /* 回古城小门 */
  px(g, mid - 34, gy - 72, 68, 72, PAL.ink);
  px(g, mid - 30, gy - 66, 60, 66, '#0b080d');
  px(g, mid - 24, gy - 54, 48, 54, 'rgba(235,179,75,0.06)');
  px(g, mid - 2, gy - 44, 4, 4, PAL.gold2);
}
function drawHallHUD() {
  const gy = sy(0);
  const tg = U.createLinearGradient(0, 0, 0, 90);
  tg.addColorStop(0, 'rgba(5,4,6,0.92)'); tg.addColorStop(1, 'rgba(5,4,6,0)');
  U.fillStyle = tg; U.fillRect(0, 0, CFG.W, 90);
  uiTrack(22, 30, '◆ 塔 门 厅 · 整 备 室', 8, UC.brass, 'left', 1.2);
  uiText(22, 60, '塔门厅', 24, UC.parch);
  uiText(22, 80, useTouch() ? '走到门前，按「进」或点底部提示整备出征' : '走到门前，按 R / F 整备出征', 10, UC.bone);
  uiFrame(476, 8, 100, 24, { fill: 'rgba(20,14,18,0.92)', accent: UC.iron2, double: false });
  uiText(526, 24, '回古城 Esc', 9, UC.parch, 'center');
  hitBox(476, 8, 100, 24, () => { S.hall = false; S.screen = 'menu'; S.menuPage = 'home'; sfx('ui'); });
  const top = gy - 178;
  HALL_DOORS.forEach((d, i) => {
    const near = S.hallNear === i;
    uiTrack(d.x, top + 74, d.name, 11, near ? d.c : UC.parch, 'center', 0.6);
    const dtag = d.mode === 'daily' ? '全服同一栋楼 · ' + dailyParts().str : d.tag;
    uiText(d.x, top + 94, dtag, near ? 8.5 : 7.8, near ? UC.bone : UC.mut, 'center');
    const best = S.meta[d.best] || 0;
    uiText(d.x, top + 110, '最高 ' + best + ' 层', 8.5, d.c, 'center');
    uiTag(d.x, top + 12, String(i + 1), near ? hexA(d.c, 0.30) : 'rgba(18,13,16,0.9)', near ? d.c : UC.mut, 8, 7, 'center');
  });
  const diffs = [['easy', '轻松', '1'], ['normal', '标准', '2'], ['hard', '困难', '3'], ['hell', '超级困难', '4']];
  uiText(312, 50, '难度', 8.5, UC.mut);
  diffs.forEach(([id, label, key], i) => {
    const x = 348 + i * 88, y = 36, w = 82, h = 22, active = S.difficulty === id;
    const ac = id === 'hell' ? PAL.red : PAL.gold;
    uiFrame(x, y, w, h, { fill: active ? 'rgba(38,24,22,0.96)' : 'rgba(16,12,15,0.88)', accent: active ? ac : UC.iron2, top: active ? ac : null, double: false });
    uiText(x + w / 2, y + 15, key + ' ' + label, 8.5, active ? ac : UC.mut, 'center');
    hitBox(x, y, w, h, () => setDifficulty(id));
  });
  uiText(348, 76, difficultyNow().desc, 8.5, UC.mut);
  /* 强制横屏时底部中央被「换向」按钮占用，提示与可点按钮上移避让 */
  const hintY = ORIENT.forced ? CFG.H - 52 : CFG.H - 18;
  if (S.hallNear >= 0) {
    const d = HALL_DOORS[S.hallNear];
    const bw = 288, bx = (CFG.W - bw) / 2, by = ORIENT.forced ? CFG.H - 82 : CFG.H - 36;
    uiFrame(bx, by, bw, 26, { fill: 'rgba(38,24,22,0.96)', accent: d.c, top: d.c, double: false });
    uiText(CFG.W / 2, by + 17, '走近 ' + d.name + ' · 点此整备出征' + (useTouch() ? '' : '（R / F）'), 9.5, d.c, 'center');
    hitBox(bx, by, bw, 26, () => enterHallDoor(S.hallNear));
  } else {
    uiText(CFG.W / 2, hintY, useTouch() ? '左右移动 · 走近门后按「进」或点底部提示 · 点难度芯片调难度' : '左右移动 · 走近门后按 R / F 整备出征 · 1/2/3/4 调难度 · Esc 返回', 9.5, UC.mut, 'center');
  }
  drawFloatTouch();
}
function drawHUDWide() {
  const tg = U.createLinearGradient(0, 0, 0, 72);
  tg.addColorStop(0, 'rgba(5,4,6,0.92)'); tg.addColorStop(1, 'rgba(5,4,6,0)');
  U.fillStyle = tg; U.fillRect(0, 0, CFG.W, 72);
  const bg2 = U.createLinearGradient(0, CFG.H - 48, 0, CFG.H);
  bg2.addColorStop(0, 'rgba(5,4,6,0)'); bg2.addColorStop(1, 'rgba(5,4,6,0.92)');
  U.fillStyle = bg2; U.fillRect(0, CFG.H - 48, CFG.W, 48);

  const low = P.hp <= CFG.hpMax * 0.3;
  uiFrame(10, 8, 212, 34, { fill: 'rgba(14,10,13,0.92)', accent: low ? PAL.red : UC.brass });
  uiFlask(24, 25, P.hp / CFG.hpMax, low);
  const hp = Math.max(0, Math.round(P.hp));
  const hpW = uiNum(40, 23, String(hp), 18, low ? PAL.gold : UC.parch, 'left', '700');
  U.font = '600 9px ' + UIN; U.fillStyle = UC.mut; U.fillText('/ ' + CFG.hpMax, 40 + hpW + 4, 23);
  const trail = P.hpTrail !== undefined ? Math.max(P.hp, P.hpTrail) : P.hp;
  uiVial(40, 29, 166, 6, P.hp / CFG.hpMax, trail / CFG.hpMax, low ? 'low' : null);
  const need = P.lv < GROW.cap ? LV_XP[P.lv - 1] : 1;
  uiSeg(40, 38, 166, 2, Math.min(1, S.xp / need), PAL.cyan, 8, '#0d1514');

  const fl = (S.arena && S.arena.active && !S.training) ? S.arena.floor : Math.max(0, Math.floor(-P.y / CFG.FH));
  uiFrame(230, 8, 78, 34, { fill: 'rgba(14,10,13,0.92)', accent: UC.brass });
  uiText(240, 21, '层', 9, UC.mut);
  uiNum(298, 30, String(fl), 23, UC.parch, 'right', '700');

  uiFrame(316, 8, 160, 34, { fill: 'rgba(14,10,13,0.90)', accent: S.collapseOn ? PAL.red : UC.iron2, double: false });
  if (S.collapseOn) {
    const d = Math.max(0, Math.ceil((S.collapseY - (P.y + P.h / 2)) / CFG.FH));
    uiText(326, 26, '崩落 ▼' + d + ' 层', 10, d <= 2 ? PAL.gold : UC.bone);
  } else if (S.mode === 'limited') uiText(326, 26, '沙漏 ' + Math.max(0, S.timer).toFixed(0) + 's', 10, PAL.gold);
  else uiText(326, 26, '崩落未启动', 10, UC.mut);

  uiIcon(488, 16, 16, PAL.gold, 'coin');
  uiNum(550, 30, String(S.coins), 13, UC.bone, 'right', '700');
  if (!useTouch()) {
    uiText(568, 20, '功绩', 8, UC.mut);
    uiNum(628, 30, String(S.score), 11, UC.mut, 'right', '600');
    uiFrame(642, 8, 68, 34, { fill: 'rgba(20,14,18,0.92)', accent: UC.brass, double: false });
    uiText(676, 27, '暂停 ' + bindingLabel('pause'), 10, UC.parch, 'center');
    hitBox(642, 8, 68, 34, () => setPaused(true));
  }

  if (S.boss && !S.boss.dead) {
    const b = S.boss, meta = BOSS_META[b.bkind] || BOSS_META.colossus;
    const act = S.arena && S.arena.active;
    const bw = act ? 400 : 300, bx = (CFG.W - bw) / 2;
    uiFrame(bx, 48, bw, act ? 28 : 20, { fill: 'rgba(16,8,10,0.92)', accent: meta.c, top: meta.c });
    uiText(bx + 10, 65, (b.phase >= 2 ? '狂 · ' : '') + meta.title, 9.5, meta.c);
    const bTrail = b.hpTrail !== undefined ? Math.max(b.hp, b.hpTrail) : b.hp;
    uiVial(bx + 142, 59, bw - 204, 6, b.hp / b.max, bTrail / b.max, null);
    uiNum(bx + bw - 8, 65, Math.max(0, Math.round(b.hp)) + ' / ' + b.max, 8, UC.bone, 'right', '700');
    if (act) uiText(bx + 10, 72, '限时 ' + Math.max(0, S.arena.timeLeft).toFixed(1) + 's · 结界封锁', 7.5, PAL.gold);
  }

  if (S.banner) {
    const b = S.banner, by = 82, bc = b.c || PAL.violet;
    if (!(S.tut && S.tut.on)) {
      px(U, 10, by, 236, 42, 'rgba(14,9,11,0.9)');
      uiText(20, by + 15, b.boss ? '镇楼封印 · 第 ' + b.floor + ' 层' : '区域规则 · 第 ' + b.floor + ' 层', 8, UC.mut);
      uiWrapText(20, by + 32, b.text, 11, bc, 216, 13, 1);
    }
  }

  const bottom = CFG.H - 42;
  const cap = CFG.runeSlots || 2;
  if (!useTouch()) {
  px(U, 10, bottom, 240, 34, 'rgba(14,10,13,0.72)');
  uiText(20, bottom + 22, '符文', 9, PAL.violet);
  for (let i = 0; i < cap; i++) {
    const x = 58 + i * 28, y = bottom + 7;
    px(U, x - 1, y - 1, 24, 24, UC.ink); px(U, x, y, 22, 22, '#191219');
    const id = P.runes[i];
    if (id) uiText(x + 11, y + 16, RUNE_NAME[id][0], 10, PAL.violet, 'center');
    else px(U, x + 9, y + 9, 3, 5, UC.iron2);
  }
  if (P.furyT > 0) uiTag(160, bottom + 6, '战意 ' + Math.ceil(P.furyT) + 's', 'rgba(120,40,24,0.95)', UC.parch, 7.5, 4);
  else if (S.combo > 1) uiTag(160, bottom + 6, '连 ×' + comboMult().toFixed(1), 'rgba(120,80,24,0.95)', UC.parch, 7.5, 4);

  }
  const strip = (x, label, key, active, c) => {
    const Wd = 214, y = bottom, h = 34;
    if (active) uiFrame(x, y, Wd, h, { fill: 'rgba(24,16,20,0.92)', accent: c, top: c, double: false });
    else px(U, x, y, Wd, h, 'rgba(16,12,15,0.55)');
    drawWeaponGlyph(U, x + 18, y + 17, key, active ? c : UC.stone);
    uiText(x + 36, y + 14, label, 8, active ? c : UC.mut);
    uiText(x + 36, y + 28, WEAP[key].name, 11, active ? UC.parch : UC.mut);
    uiNum(x + Wd - 10, y + 28, String(Math.round(WEAP[key].dmg * P.atkMul * comboMult())), 15, active ? c : UC.stone, 'right', '700');
  };
  if (useTouch()) strip(253, P.slot === 0 ? '近战 · 点按攻击' : '远程 · 长按连射', P.slot === 0 ? P.weapon.melee : P.weapon.ranged, true, P.slot === 0 ? PAL.red : PAL.cyan);
  else {
    strip(258, '近战', P.weapon.melee, P.slot === 0, PAL.red);
    strip(480, '远程', P.weapon.ranged, P.slot === 1, PAL.cyan);
  }

  drawTutorialWide();
  drawHUDToasts();
  drawFloatTouch();
}
const GUIDE_PAGES = [
  { title: '先学会向上', sub: '这楼的唯一方向', get lines() { return [useTouch() ? '左摇杆左右滑动移动，上推即保持方向起跳。' : bindingText('left') + ' / ' + bindingText('right') + ' 左右移动。', useTouch() ? '上推摇杆起跳，空中回中再推一次可二段跳。' : bindingText('jump') + ' 跳跃，空中再按一次可二段跳。', '贴住墙时保持移动可短暂挂壁，再跳可蹬墙向上。', useTouch() ? '走近门厅的模式门，点击门前提示整备出征。' : '先走到门厅的三座门前，按 R / F 进入对应模式。']; } },
  { title: '打，还是跑', sub: '杀怪才有奖励，跳过就空手', get lines() { return [(useTouch() ? '点「攻」' : bindingText('attack')) + ' 近战挥击，靠近魔物再出手。', '远程武器按住不放可以连续射击。', ...(useTouch() ? ['空中下推摇杆 = 下砸，落地震开周围敌人。'] : [bindingText('slam') + ' 空中下砸，落地震开周围敌人。']), (useTouch() ? '点「闪」' : bindingText('dodge')) + ' 闪避，短暂无敌，可以穿过弹幕和机关。']; } },
  { title: '崩落不等人', sub: '脚下会持续追上来', lines: ['崩落线从下方追来，停得越久越危险。', '击杀会掉金币与经验；金币在商店换补给。', '符文是局内道具，印记是跨局成长货币。', '难度可在塔门厅用数字键 1 / 2 / 3 / 4 切换。'] },
  { title: '门厅与成长', sub: '三座门，三种塔', lines: ['无尽之塔：崩落 8 秒后启动，越拖越危险。', '沙漏限时：60 秒内冲最高层，无崩落线。', '今日怪谈：全服同一栋楼，北京时间零点换梦。', '训练场可练武器、怪物和机关；新手引导随时从主菜单打开。'] },
];
function drawGuideWide() {
  const T = performance.now() / 1000;
  const page = GUIDE_PAGES[Math.max(0, Math.min(GUIDE_PAGES.length - 1, S.guidePage))];
  U.fillStyle = 'rgba(5,4,6,0.88)'; U.fillRect(0, 0, CFG.W, CFG.H);
  uiEmbers(T, 12);
  uiFrame(46, 22, 628, 359, { fill: 'rgba(15,11,14,0.985)', accent: PAL.cyan, top: PAL.cyan, hot: true });
  uiTrack(68, 48, '◆ 新 手 引 导', 8.5, PAL.cyan, 'left', 1.2);
  uiText(68, 78, page.title, 26, UC.parch);
  uiText(68, 100, page.sub, 11, PAL.gold);
  uiRule(116, 68, 584);
  page.lines.forEach((line, i) => {
    uiText(80, 144 + i * 34, '◆', 8, PAL.cyan);
    uiWrapText(100, 144 + i * 34, line, 11, UC.bone, 530, 16, 1);
  });
  uiFrame(68, 292, 584, 34, { fill: 'rgba(24,16,20,0.92)', accent: UC.brass, double: false });
  uiText(82, 314, '操作提示：← → 翻页 · Enter / G 关闭 · 主菜单可随时重新打开', 8.5, UC.mut);
  for (let i = 0; i < GUIDE_PAGES.length; i++) {
    px(U, 68 + i * 15, 340, 10, 3, i === S.guidePage ? PAL.cyan : UC.iron2);
    hitBox(66 + i * 15, 336, 14, 10, () => { S.guidePage = i; });
  }
  uiButton(68, 348, 154, 24, { title: '上一步', c: UC.bone, key: '←' });
  hitBox(68, 348, 154, 24, () => { S.guidePage = Math.max(0, S.guidePage - 1); });
  uiButton(486, 348, 166, 24, { title: S.guidePage >= 3 ? '完成' : '下一步', c: PAL.cyan, key: '→' });
  hitBox(486, 348, 166, 24, () => { if (S.guidePage >= 3) S.guideOpen = false; else S.guidePage++; });
  hitBox(0, 0, CFG.W, 20, () => { S.guideOpen = false; });
}
/* ---------- 出征整备：只带两把（近战 1 + 远程 1） ---------- */
function uiMiniBar(x, y, w, h, p, c) {
  x = Math.round(x); y = Math.round(y);
  U.fillStyle = 'rgba(5,4,6,0.92)'; U.fillRect(x, y, w, h);
  U.fillStyle = hexA(c, 0.18); U.fillRect(x, y, w, h);
  U.fillStyle = hexA(c, 0.92); U.fillRect(x, y, Math.max(0, Math.round(w * Math.min(1, Math.max(0, p)))), h);
  U.fillStyle = 'rgba(214,196,166,0.26)'; U.fillRect(x, y, w, 1);
}
const LOADOUT_COL = {
  knife: PAL.cyan, long: PAL.red, hammer: PAL.gold, ember: '#e0703c', crossbow: PAL.cyan2, orb: PAL.violet,
};
function lockedWeapons(col) {
  const out = [];
  if (col === 0) {
    if (!S.meta.hammer) out.push({ key: 'hammer', need: '印记祭坛 · 成就「屠夫之手」' });
    if (!S.meta.ember) out.push({ key: 'ember', need: '黑市孤品 · 局内商店 120 金币' });
  } else if (!S.meta.orb) {
    out.push({ key: 'orb', need: '印记祭坛 · 成就「塔尖回响」' });
  }
  return out;
}
function drawWeaponRow(x, y, w, key, selected, locked, need) {
  const W = WEAP[key], c = LOADOUT_COL[key] || PAL.gold;
  const on = selected && !locked;
  uiFrame(x, y, w, 54, {
    fill: locked ? 'rgba(13,10,13,0.92)' : (on ? 'rgba(26,20,24,0.98)' : 'rgba(17,12,15,0.94)'),
    accent: locked ? UC.stone : (on ? c : UC.ink3), top: locked ? null : (on ? c : null),
  });
  if (on) px(U, x + 3, y + 8, 3, 38, hexA(c, 0.9));
  px(U, x + 16, y + 10, 34, 34, UC.ink); px(U, x + 17, y + 11, 32, 32, '#120e11');
  drawWeaponGlyph(U, x + 33, y + 27, key, locked ? UC.stone : c);
  uiText(x + 60, y + 23, W.name, 13, locked ? UC.stone : (on ? UC.hi : UC.parch));
  uiText(x + 60, y + 38, W.tag, 8.5, locked ? UC.stone : UC.mut);
  if (locked) {
    uiText(x + w - 14, y + 23, '未解锁', 9, UC.stone, 'right');
    uiWrapText(x + w - 132, y + 33, need, 7.5, UC.stone, 118, 10, 1);
  } else {
    if (on) uiTag(x + w - 14, y + 12, '已选', hexA(c, 0.22), c, 7.5, 5, 'right');
    else uiText(x + w - 14, y + 22, '点击选择', 8.5, UC.mut, 'right');
    uiNum(x + w - 14, y + 40, String(W.dmg), 13, on ? c : UC.bone, 'right', '700');
    uiText(x + w - 22 - String(W.dmg).length * 8, y + 40, '伤 · ' + W.cd.toFixed(2) + 's', 7.5, UC.stone, 'right');
  }
  if (locked) hitBox(x, y, w, 54, () => { toast('尚未解锁：' + need, PAL.mut); sfx('deny'); });
  else hitBox(x, y, w, 54, () => pickLoadout(key));
}
function drawLoadoutWide() {
  const T = performance.now() / 1000;
  const L = S.loadout || { picks: { melee: 'knife', ranged: 'crossbow' }, col: 0, mode: S.mode };
  uiBackdrop(T, 'rgba(70,30,18,0.16)');
  uiTrack(24, 26, '◆ 出 征 整 备', 8.5, PAL.gold, 'left', 1.4);
  uiText(24, 58, '只带两把', 23, UC.parch);
  const mi = modeMeta(L.mode || 'endless') || { name: '无尽' };
  uiText(24, 76, '近战一把 + 远程一把 · 其余的留在塔外 · 本次：' + mi.name, 9.5, UC.mut);
  uiButton(478, 20, 218, 46, { title: '就此出征', sub: 'Enter 确认 · 已选好的两把', c: PAL.gold, size: 16 });
  hitBox(478, 20, 218, 46, () => confirmLoadout());

  [0, 1].forEach(col => {
    const x = col === 0 ? 24 : 364, PY = 92, PW = 332, PH = 274;
    const c = col === 0 ? PAL.red : PAL.cyan;
    uiFrame(x, PY, PW, PH, { fill: 'rgba(12,9,12,0.92)', accent: hexA(c, 0.55), double: false });
    px(U, x + 10, PY + 10, PW - 20, 22, hexA(c, 0.10));
    uiText(x + 16, PY + 26, col === 0 ? '近战槽 · 壹' : '远程槽 · 贰', 10, c);
    const picked = L.picks[loadoutSlotKey(col)];
    uiText(x + PW - 16, PY + 26, WEAP[picked].name, 9, UC.bone, 'right');
    const own = loadoutList(col), locks = lockedWeapons(col);
    let ry = PY + 38;
    own.forEach(k => { drawWeaponRow(x + 8, ry, PW - 16, k, k === picked, false, ''); ry += 59; });
    locks.forEach(l => { drawWeaponRow(x + 8, ry, PW - 16, l.key, false, true, l.need); ry += 59; });
    if (L.col === col) {
      const idx = Math.max(0, own.indexOf(picked));
      uiChevron(x - 5, PY + 38 + idx * 59 + 27, c, -1);
    }
  });
  uiDivider(374, 24, CFG.W - 48);
  uiText(24, 392, '← → 换列 · ↑ ↓ 换武器 · 数字键直选 · Enter 出征 · ESC 返回', 8.5, UC.mut);
  uiText(CFG.W - 24, 392, '两把都带不上第三把', 8.5, UC.stone, 'right');
}
function drawMenuWide() {
  const T = performance.now() / 1000;
  uiBackdrop(T, 'rgba(80,24,18,0.14)');
  const mg = U.createRadialGradient(610, 86, 4, 610, 86, 130);
  mg.addColorStop(0, 'rgba(224,60,49,0.22)'); mg.addColorStop(1, 'rgba(224,60,49,0)');
  U.fillStyle = mg; U.fillRect(430, 0, 290, 260);
  U.fillStyle = '#9e2620'; U.beginPath(); U.arc(610, 86, 34, 0, 7); U.fill();
  U.fillStyle = '#c23a2c'; U.beginPath(); U.arc(606, 82, 29, 0, 7); U.fill();

  uiTrack(48, 40, '◆ AI+∞ 开发者创作大赛 · 第三期', 8.5, UC.brass, 'left', 1.3);
  uiText(48, 142, '这个怪楼', 44, UC.parch);
  uiText(48, 194, '有点高', 50, UC.parch);
  px(U, 48, 210, 160, 4, UC.ink); px(U, 49, 211, 158, 2, UC.brass);
  uiText(48, 244, '这楼不给你停下来的机会', 13, PAL.gold);
  uiText(48, 268, '竖屏动作骨架 · 全横屏世界 · 向上才是唯一方向', 9.5, UC.bone);

  const savedBest = S.meta.best || 0;
  uiFrame(48, 294, 128, 48, { fill: 'rgba(14,10,13,0.90)', double: false });
  uiText(58, 312, '最高层', 8, UC.mut);
  uiNum(58, 334, String(savedBest), 17, UC.parch, 'left', '700');
  uiFrame(184, 294, 128, 48, { fill: 'rgba(14,10,13,0.90)', accent: PAL.red, double: false });
  uiText(194, 312, '印记', 8, UC.mut);
  uiNum(194, 334, String(S.meta.marks), 17, PAL.red, 'left', '700');
  uiText(48, 374, '先学走、跳、攻击 · 音乐与操控可在设置调整', 8.5, UC.stone);

  uiButton(390, 58, 306, 76, {
    title: '开始游戏', sub: '走进塔门 · 边玩边学，无需先读说明', c: PAL.gold, size: 23,
    icon: (x, y) => uiSkull(x, y, PAL.gold, 1.3),
  });
  hitBox(390, 58, 306, 76, () => startHall());
  uiButton(390, 152, 306, 56, { title: '设置', sub: '音乐：音效与背景音乐 · 操控与键位', c: PAL.violet, size: 19 });
  hitBox(390, 152, 306, 56, () => openSettings('menu'));
  uiButton(390, 222, 306, 56, { title: '印记解锁', sub: '永久成长与神兵', c: PAL.red, key: 'U', size: 17 });
  hitBox(390, 222, 306, 56, () => { S.menuPage = 'unlock'; });
  uiButton(390, 292, 306, 56, { title: '学习与练习', sub: '操作说明 · 新手引导 · 训练场', c: UC.bone, size: 17 });
  hitBox(390, 292, 306, 56, () => { S.menuPage = 'learn'; });
  uiText(390, 384, '点击进入 · 第二版 V2.1 · 键位自定义 · 手机触控', 9, UC.mut);
  uiCandle(26, 386, T, 9); uiCandle(694, 386, T + 1.4, 9);
}
function drawLearnWide() {
  uiBackdrop(performance.now() / 1000);
  uiBackBtn();
  uiWideHeader('◆ 学 习 与 练 习', '按需探索，不必背完', '基础操作会在开局边玩边教，这里保留完整规则和练习场');
  const choices = [
    ['操作说明', '查询当前键位与身法', () => { S.helpOpen = true; clearGameplayInput(); }],
    ['新手引导', '翻阅攀登、战斗与成长规则', () => { S.guideOpen = true; S.guidePage = 0; }],
    ['训练场', '不死庇护下练习武器、怪物与机关', () => startTraining()],
  ];
  choices.forEach(([title, sub, act], i) => {
    const y = 116 + i * 80;
    uiButton(100, y, 520, 62, { title, sub, c: i === 2 ? PAL.gold : PAL.cyan });
    hitBox(100, y, 520, 62, act);
  });
}
function drawSelectWide() {
  const T = performance.now() / 1000;
  uiBackdrop(T);
  uiBackBtn();
  uiWideHeader('◆ 择 塔 而 登', '选择一座魔塔', '三座魔塔，三种诅咒，同一副身手');
  const keys = ['endless', 'limited', 'daily'];
  keys.forEach((key, i) => {
    const mi = modeMeta(key), x = 24 + i * 228, y = 110, w = 216, h = 228;
    uiFrame(x, y, w, h, { fill: 'rgba(18,13,16,0.96)', accent: mi.c, top: mi.c });
    uiNum(x + 14, y + 30, ['I', 'II', 'III'][i], 14, mi.c, 'left', '700');
    uiText(x + 14, y + 56, mi.name, 19, UC.parch);
    uiText(x + 14, y + 74, mi.tag, 9, UC.bone);
    for (let j = 0; j < 3; j++) {
      uiText(x + 14, y + 102 + j * 24, '· ' + mi.rules[j][0], 9.5, UC.mut);
    }
    uiTrack(x + 14, y + h - 34, mi.note, 8, UC.stone, 'left', 0.4);
    uiText(x + w - 14, y + 26, '最高', 8, UC.mut, 'right');
    uiNum(x + w - 14, y + 46, String(S.meta[mi.best] || 0), 18, mi.c, 'right', '700');
    hitBox(x, y, w, h, () => openLoadout(key, 'menu'));
  });
  uiText(CFG.W / 2, 368, '点击魔塔 → 出征整备选两把武器 · 成绩按塔分别铭刻 · ESC 返回', 9, UC.mut, 'center');
}
function drawUnlockWide() {
  const T = performance.now() / 1000;
  uiBackdrop(T, 'rgba(110,20,18,0.16)');
  uiBackBtn();
  uiWideHeader('◆ 印 记 解 锁', '永久成长', '献上攀爬换来的印记，为下一次攀登铸造起点', PAL.red);
  uiNum(CFG.W - 28, 66, String(S.meta.marks), 22, PAL.red, 'right', '700');
  uiText(CFG.W - 28, 82, '可用印记', 8, UC.mut, 'right');
  const rows = [
    ['hammer', 30, '震岳铁锤', '26 伤 · 慢速震地', PAL.red, 'hammer'],
    ['orb', 50, '湮灭法球', '14 伤 · 抛物线爆炸', PAL.cyan, 'orb'],
    ['slot', 40, '符文槽 +1', '符文上限 3', PAL.violet, 'slot'],
    ['revive', 60, '印记复生', '每局一次满血复活', PAL.gold, 'revive'],
  ];
  rows.forEach(([k, cost, label, sub, c, icon], i) => {
    const x = 24 + (i % 2) * 340, y = 112 + Math.floor(i / 2) * 105, w = 332, h = 92;
    const own = !!S.meta[k], afford = S.meta.marks >= cost;
    const ai = achInfo(k), okAch = !ai || ai.done;
    const ready = !own && okAch && afford;
    uiFrame(x, y, w, h, { fill: own ? 'rgba(20,24,18,0.96)' : (okAch ? 'rgba(18,13,16,0.96)' : 'rgba(13,11,14,0.96)'), accent: own ? PAL.green : (okAch ? c : UC.stone), top: own ? PAL.green : (okAch ? c : null) });
    px(U, x + 14, y + 22, 36, 36, UC.ink); px(U, x + 15, y + 23, 34, 34, '#140f12');
    uiIcon(x + 24, y + 32, 16, okAch ? c : UC.stone, icon);
    uiText(x + 62, y + 32, label, 14, own ? PAL.green : (okAch ? UC.parch : UC.bone));
    uiText(x + 62, y + 50, sub, 9, UC.mut);
    if (own) {
      uiTag(x + w - 14, y + 26, '已铸成', 'rgba(30,60,32,0.95)', PAL.green, 8, 6, 'right');
      uiText(x + w - 14, y + 62, '已进兵器库', 8.5, UC.mut, 'right');
    } else if (ai && !ai.done) {
      /* 成就未达成：锁住价格，只显示进度——避免玩家白花印记 */
      uiText(x + w - 14, y + 26, '需先达成成就', 8.5, UC.stone, 'right');
      uiText(x + w - 14, y + 46, '「' + ai.name + '」', 10.5, PAL.gold, 'right');
      uiMiniBar(x + w - 134, y + 56, 120, 5, ai.p, PAL.gold);
      uiText(x + w - 14, y + 76, ai.unit + ' ' + ai.val + '/' + ai.goal + ai.unit2, 8, UC.mut, 'right');
    } else {
      uiNum(x + w - 14, y + 34, String(cost), 17, afford ? PAL.red : UC.stone, 'right', '700');
      uiTrack(x + w - 14, y + 54, afford ? '献 祭' : '印记不足', 7.5, afford ? UC.bone : UC.stone, 'right', 1.0);
      if (ai) {
        uiMiniBar(x + w - 134, y + 64, 120, 5, ai.p, PAL.green);
        uiText(x + w - 14, y + 82, '成就已达成 · ' + ai.unit + ' ' + ai.val + '/' + ai.goal + ai.unit2, 7.5, PAL.green, 'right');
      }
    }
    hitBox(x, y, w, h, () => buyMeta(k, cost, label));
  });
  uiText(CFG.W / 2, 358, '印记来源：到达层数 ×2 + 击杀数 + 无伤通关 20 · 铸成之物下一局生效', 8.5, UC.mut, 'center');
  uiText(CFG.W / 2, 374, '武器须先达成对应成就方可献祭解锁 · 另有一把「烬铁巨剑」只在局内黑市出售', 8.5, UC.stone, 'center');
}
function drawDeadWide() {
  const T = performance.now() / 1000;
  uiBackdrop(T, 'rgba(110,18,18,0.22)');
  uiTrack(24, 28, '◆ 英雄陨落 · 魂归魔塔', 8.5, PAL.red, 'left', 1.4);
  uiText(24, 60, '本局复盘', 24, UC.parch);
  const best = S.finalBest !== undefined ? S.finalBest : Math.max(0, Math.floor(-P.y / CFG.FH));
  const deathFloor = S.finalDeathFloor !== undefined ? S.finalDeathFloor : best;
  const dmgInfo = S.lastDamage && S.lastDamage.reason === S.deathReason ? S.lastDamage : null;
  const srcTag = dmgInfo ? dmgInfo.srcTag : '';
  const cause = reasonText(S.deathReason, srcTag);
  const advice = deathAdvice(S.deathReason, srcTag);
  uiFrame(24, 76, 400, 204, { fill: 'rgba(22,12,15,0.96)', accent: PAL.red, top: PAL.red, hot: true });
  uiSkull(45, 112, PAL.red, 1.5);
  uiText(66, 106, '死因 · 下次怎么改', 8.5, UC.mut);
  uiText(66, 132, cause, 18, PAL.red);
  uiText(66, 150, '第 ' + deathFloor + ' 层 · ' + (S.frames / 60).toFixed(0) + ' 秒', 10, UC.stone);
  uiWrapText(42, 176, '建议：' + advice, 10.5, UC.parch, 362, 16, 3);
  uiText(42, 234, '受击 ' + (S.hitsTaken || 0) + ' 次 · 倒下 ' + S.deaths + ' 次', 10, UC.bone);
  uiFrame(440, 76, 256, 204, { fill: 'rgba(16,11,14,0.96)', accent: UC.brass });
  uiText(458, 100, '最高到达', 9, UC.mut);
  uiNum(458, 146, String(best), 42, UC.parch, 'left', '700');
  uiText(458, 160, '层', 9, UC.brass);
  if (S.finalNewRecord && best > 0) uiTag(680, 96, '新纪录', 'rgba(130,30,26,0.95)', UC.hi, 8, 5, 'right');
  uiText(458, 194, '印记 +' + S.runMarks, 15, PAL.red);
  uiText(458, 220, '击杀 ' + S.kills + ' · 金币 ' + S.coins + ' · 功绩 ' + S.score, 9.5, UC.bone);
  uiText(458, 242, '受击/倒下已拆分记录', 8.5, UC.stone);
  uiButton(24, 300, 330, 52, { title: '重燃余烬 · 再战一局', sub: '先选两把武器再入塔', c: PAL.cyan, icon: (x, y) => uiSkull(x, y, PAL.cyan, 1) });
  hitBox(24, 300, 330, 52, () => openLoadout(S.mode, 'dead'));
  uiButton(366, 300, 330, 52, { title: '长眠归去 · 返回门厅', sub: '回到塔外整备间', c: UC.bone, icon: (x, y) => uiIcon(x - 8, y - 8, 16, UC.bone, 'shield') });
  hitBox(366, 300, 330, 52, () => startHall());
  uiText(CFG.W / 2, 380, '每一具倒在阶梯上的骸骨，都是后来者的踏脚石', 9, UC.mut, 'center');
}
function drawShopWide() {
  const T = performance.now() / 1000;
  uiBackdrop(T, 'rgba(40,24,14,0.18)');
  uiTrack(24, 28, '◆ 圣所暗室 · 守门吏', 8.5, PAL.gold, 'left', 1.4);
  uiText(24, 62, '黑市契约', 24, UC.parch);
  uiText(24, 82, '金币购买补给 · 数字键 1 / 2 / 3 / 4 快捷购入', 9.5, UC.mut);
  uiNum(CFG.W - 24, 60, String(S.coins), 18, PAL.gold, 'right', '700');
  uiText(CFG.W - 24, 80, '当前金币', 8, UC.mut, 'right');
  let topY = 96;
  if (S.rule) {
    uiFrame(24, 94, CFG.W - 48, 30, { fill: 'rgba(26,16,22,0.94)', accent: PAL.violet, double: false });
    uiText(36, 114, '门后恶兆 · ' + S.rule.text + ' · ' + S.rule.mech, 9.5, UC.bone);
    topY = 132;
  }
  const offs = shopOffers();
  const cardH = 266 - topY;
  offs.slice(0, 3).forEach((o, i) => {
    const x = 24 + i * 228, y = topY, w = 216;
    const afford = S.coins >= o.cost, can = o.ok && afford;
    uiFrame(x, y, w, cardH, { fill: can ? 'rgba(20,15,18,0.96)' : 'rgba(14,10,12,0.94)', accent: can ? PAL.gold : UC.stone, top: can ? PAL.gold : null });
    uiKeycap(x + 14, y + 14, 26, 24, String(i + 1), 10, can ? PAL.gold : UC.stone);
    uiText(x + 50, y + 30, o.name, 14, can ? UC.parch : UC.stone);
    uiWrapText(x + 14, y + 54, o.desc, 9, o.ok ? UC.mut : UC.stone, w - 28, 14, 3);
    uiNum(x + w - 14, y + cardH - 38, String(o.cost), 17, afford ? PAL.gold : PAL.red, 'right', '700');
    uiText(x + 14, y + cardH - 15, can ? '点击购入' : (!o.ok ? o.reason : '金币不足'), 8.5, can ? UC.bone : UC.stone);
    hitBox(x, y, w, cardH, () => buyOffer(i));
  });
  /* 黑市孤品横条：只能在此用金币买断，不进印记祭坛、不掉落 */
  const e = offs[3];
  if (e) {
    const x = 24, y = 276, w = CFG.W - 48, h = 56;
    const afford = S.coins >= e.cost, can = e.ok && afford;
    uiFrame(x, y, w, h, { fill: can ? 'rgba(28,16,14,0.97)' : 'rgba(14,11,12,0.94)', accent: can ? '#e0703c' : UC.stone, top: can ? '#e0703c' : null, hot: can });
    uiKeycap(x + 14, y + 16, 26, 24, '4', 10, can ? '#e0703c' : UC.stone);
    px(U, x + 52, y + 14, 28, 28, UC.ink); px(U, x + 53, y + 15, 26, 26, '#140e0c');
    drawWeaponGlyph(U, x + 66, y + 28, 'ember', can ? '#e0703c' : UC.stone);
    uiText(x + 90, y + 24, e.name, 14, can ? UC.parch : UC.stone);
    uiText(x + 90, y + 41, '唯一获取途径 · 永久解锁后可在出征整备时携带', 8.5, UC.mut);
    uiNum(x + w - 14, y + 34, String(e.cost), 18, afford ? PAL.gold : PAL.red, 'right', '700');
    uiText(x + w - 14, y + 48, can ? '点击购入' : (!e.ok ? e.reason : '金币不足'), 8, can ? UC.bone : UC.stone, 'right');
    hitBox(x, y, w, h, () => buyOffer(3));
  }
  uiButton(24, 344, 430, 44, { title: '踏入门界 · 继续攀登', sub: '本次区域恶兆立即生效', c: PAL.cyan, icon: (x, y) => uiChevron(x, y, PAL.cyan, 1) });
  hitBox(24, 344, 430, 44, () => { S.shopOpen = false; });
  uiText(CFG.W - 24, 371, '空格 / ESC 继续', 9, UC.mut, 'right');
}
function drawBossRewardWide() {
  const T = performance.now() / 1000;
  uiBackdrop(T, 'rgba(60,30,10,0.20)');
  const cy0 = 24, ch = 357, cx0 = 24, cw = CFG.W - 48;
  uiFrame(cx0, cy0, cw, ch, { fill: 'rgba(14,10,13,0.985)', accent: PAL.gold, top: PAL.gold, hot: true });
  uiTrack(cx0 + 18, cy0 + 22, '◆ 战 利 品 赐 福', 8, PAL.gold, 'left', 1.2);
  uiText(cx0 + 18, cy0 + 50, '上下结界破除 · 崩落后退 4 层 · 择一永铸本局法力', 9.5, UC.bone);
  S.bossRewards.forEach((c, i) => {
    const x = cx0 + 18 + i * 218, y = cy0 + 70, w = 206, h = 232;
    uiFrame(x, y, w, h, { fill: 'rgba(22,14,18,0.97)', accent: c.c, top: c.c, hot: true });
    uiTag(x + 10, y + 12, c.tag, hexA(c.c, 0.18), c.c, 7.5, 5);
    uiText(x + 10, y + 46, c.title, 16, UC.parch);
    uiWrapText(x + 10, y + 72, c.desc, 9.5, UC.hi, w - 20, 15, 5);
    uiText(x + 10, y + h - 16, '数字键 ' + (i + 1) + ' / 点击选择', 8, UC.mut);
    hitBox(x, y, w, h, () => chooseBossReward(i));
  });
  uiText(CFG.W / 2, 368, '每次镇楼讨伐只能选择一项赐福', 9, UC.mut, 'center');
}
function drawPauseWide() {
  const T = performance.now() / 1000;
  U.fillStyle = 'rgba(5,4,6,0.85)'; U.fillRect(0, 0, CFG.W, CFG.H);
  uiEmbers(T, 12);
  uiFrame(88, 22, 544, 360, { fill: 'rgba(15,11,14,0.98)', accent: UC.brass, top: UC.brass, hot: true });
  uiTrack(108, 44, S.training ? '◆ 试炼挂起 · 动作调校' : '◆ 魔塔驻足 · 局内挂起', 8, PAL.gold, 'left', 1.2);
  uiText(108, 74, S.training ? '试炼暂停' : '攀登暂停', 22, UC.parch);
  const y0 = 96, bw = 270, bh = 44, gap = 4;
  const buttons = [
    { title: S.training ? '重返试炼' : '继续攀登', c: PAL.cyan, key: bindingLabel('pause'), act: () => setPaused(false) },
    { title: S.training ? '清场重置' : '重新开局', c: PAL.gold, key: 'R', act: () => { setPaused(false, true); if (S.training) resetDummy(); else startRun(S.mode); } },
    { title: '操作说明', c: UC.bone, key: bindingLabel('help'), act: () => { S.helpOpen = true; clearGameplayInput(); } },
    { title: '音乐', c: PAL.green, key: '', act: () => openSettings('pause', 'music') },
    { title: S.training ? '离开训练场' : '舍弃本局 · 返回标题', c: PAL.red, key: 'Q', act: () => { if (S.training) leaveTraining(); else { setPaused(false, true); S.screen = 'menu'; S.menuPage = 'home'; } } },
    { title: '操控与键位', c: PAL.violet, key: '', act: () => openSettings('pause', 'controls') },
  ];
  buttons.forEach((b, i) => {
    const y = y0 + i * (bh + gap);
    uiButton(108, y, bw, bh, { title: b.title, sub: '', c: b.c, key: b.key });
    hitBox(108, y, bw, bh, b.act);
  });
  uiFrame(394, 96, 218, 216, { fill: 'rgba(22,15,18,0.94)', accent: UC.brass });
  uiButton(394, 320, 218, 44, { title: '角色画卷', sub: '', c: UC.bone, key: bindingLabel('panel') });
  hitBox(394, 320, 218, 44, () => { S.panel = true; });
  const fl = (S.arena && S.arena.active && !S.training) ? S.arena.floor : Math.max(0, Math.floor(-P.y / CFG.FH));
  uiText(410, 118, '当前状态', 10, UC.brass);
  uiText(410, 144, '所在层', 8, UC.mut); uiNum(592, 146, String(fl), 16, UC.parch, 'right', '700');
  uiText(410, 174, '生命', 8, UC.mut); uiNum(592, 176, Math.max(0, Math.round(P.hp)) + '/' + CFG.hpMax, 14, P.hp <= CFG.hpMax * 0.3 ? PAL.red : PAL.green, 'right', '700');
  uiText(410, 204, '金币', 8, UC.mut); uiNum(592, 206, String(S.coins), 14, PAL.gold, 'right', '700');
  uiText(410, 234, '功绩', 8, UC.mut); uiNum(592, 236, String(S.score), 14, UC.cyan, 'right', '700');
  uiText(410, 264, '音效 / 背景音乐', 8, UC.mut); uiText(592, 264, (S.meta.sound === false ? '关' : '开') + ' / ' + (S.meta.bgm === false ? '关' : '开'), 9, UC.bone, 'right');
  uiText(410, 292, '离开视窗自动挂起', 8, UC.stone);
  if (S.training) {
    uiButton(394, 320, 218, 46, { title: '训练工具', sub: '武器 / 怪物 / 机关', c: PAL.gold, size: 13 });
    hitBox(394, 320, 218, 46, () => { setPaused(false, true); S.trainToolsOpen = true; clearGameplayInput(); });
  }
}
function drawPanelWide() {
  const T = performance.now() / 1000;
  U.fillStyle = 'rgba(5,4,6,0.86)'; U.fillRect(0, 0, CFG.W, CFG.H);
  uiFrame(54, 22, 612, 360, { fill: 'rgba(15,11,14,0.98)', accent: UC.brass, top: UC.brass, hot: true });
  uiTrack(76, 46, '◆ 角 色 画 卷', 8, UC.brass, 'left', 1.2);
  uiText(76, 76, '攀登者', 22, UC.parch);
  uiText(76, 100, '阶 ' + P.lv + ' · 生命 ' + Math.round(P.hp) + '/' + CFG.hpMax + ' · 攻击 ×' + P.atkMul.toFixed(2) + ' · 速度 ×' + P.spdMul.toFixed(2), 10, UC.bone);
  uiText(76, 136, '武器', 10, PAL.gold);
  uiText(76, 158, '近战 · ' + WEAP[P.weapon.melee].name + '　' + WEAP[P.weapon.melee].dmg + ' 伤', 11, UC.parch);
  uiText(76, 180, '远程 · ' + WEAP[P.weapon.ranged].name + '　' + WEAP[P.weapon.ranged].dmg + ' 伤', 11, UC.parch);
  uiText(76, 216, '符文', 10, PAL.violet);
  const cap = CFG.runeSlots || 2;
  for (let i = 0; i < cap; i++) {
    const x = 76 + i * 90, y = 230;
    uiFrame(x, y, 78, 40, { fill: 'rgba(30,20,34,0.9)', accent: PAL.violet, double: false });
    uiText(x + 8, y + 25, P.runes[i] ? RUNE_NAME[P.runes[i]] : '空槽', 10, P.runes[i] ? PAL.violet : UC.stone);
  }
  uiText(76, 306, '金币 ' + S.coins + ' · 功绩 ' + S.score + ' · 击杀 ' + S.kills, 9.5, UC.bone);
  uiText(394, 136, '本局状态', 10, PAL.gold);
  uiText(394, 160, '所在层 ' + Math.max(0, Math.floor(-P.y / CFG.FH)), 10, UC.parch);
  uiText(394, 184, '连击 ×' + (S.combo > 1 ? comboMult().toFixed(1) : '1.0'), 10, UC.cyan);
  uiText(394, 208, '崩落 ' + (S.collapseOn ? '已启动' : '未启动'), 10, S.collapseOn ? PAL.red : UC.mut);
  uiText(394, 232, '训练场' + (S.training ? ' · 不死庇护' : ''), 9.5, UC.mut);
  uiButton(76, 326, 300, 40, { title: '关闭画卷', c: PAL.cyan, key: bindingLabel('panel') });
  hitBox(76, 326, 300, 40, () => { S.panel = false; });
}
function drawHelpWide() {
  const T = performance.now() / 1000;
  U.fillStyle = 'rgba(5,4,6,0.86)'; U.fillRect(0, 0, CFG.W, CFG.H);
  uiFrame(32, 20, 656, 364, { fill: 'rgba(15,11,14,0.98)', accent: UC.brass, top: UC.brass, hot: true });
  uiTrack(52, 44, '◆ 操 作 说 明', 8, UC.brass, 'left', 1.2);
  uiText(52, 72, '键位与身法', 22, UC.parch);
  uiText(52, 94, '桌面键盘 / 手机触屏自动适配 · 可在「键位设置」中自定义', 9.5, UC.mut);
  const rows = useTouch() ? [
    ['左摇杆', '左右滑动移动'],
    ['上推', '跳跃，空中再推二段跳'],
    ['攻', '近战挥击 / 远程长按连射'],
    ['闪', '闪避，短暂无敌'],
    ['远程 / 近战', '切换近战 / 远程'],
    ['暂停', '暂停游戏'],
    ['下推', '空中下砸（摇杆下推）'],
    ['M / N', '音效 / 背景音乐（仅键盘）'],
  ] : [
    [bindingText('left') + ' / ' + bindingText('right'), '左右移动'],
    [bindingText('jump'), '跳跃，空中再按二段跳'],
    [bindingText('attack'), '近战挥击 / 远程长按连射'],
    [bindingText('slam'), '空中下砸'],
    [bindingText('dodge'), '闪避，短暂无敌'],
    [bindingText('slot'), '切换近战 / 远程'],
    [bindingText('weapon'), '循环切换武器'],
    [bindingText('pause') + ' / ' + bindingText('help'), '暂停 / 本说明'],
    [bindingText('pact'), '战祭坛开战'],
    ['M / N', '音效 / 背景音乐开关'],
  ];
  rows.forEach(([k, v], i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = 52 + col * 306, y = 128 + row * 34;
    uiText(x, y, k, 10.5, PAL.cyan);
    uiText(x + 118, y, v, 9.5, UC.bone);
  });
  uiText(52, 314, '核心目标：向上跳、边打边上；台阶会持续崩塌，杀怪才有奖励。', 10.5, PAL.gold);
  uiWrapText(52, 334, useTouch() ? '点击此处闭合说明。' : '按 ' + bindingLabel('help') + ' 或点击此处闭合说明。', 9.5, UC.mut, 600, 16, 2);
  hitBox(0, 0, CFG.W, CFG.H, () => closeHelp());
}
function drawTrainingHUDWide() {
  const tg = U.createLinearGradient(0, 0, 0, 76);
  tg.addColorStop(0, 'rgba(5,4,6,0.94)'); tg.addColorStop(1, 'rgba(5,4,6,0)');
  U.fillStyle = tg; U.fillRect(0, 0, CFG.W, 76);
  uiFrame(10, 8, 164, 42, { fill: 'rgba(16,11,14,0.94)', accent: PAL.cyan, top: PAL.cyan });
  uiTrack(20, 23, '◆ 试炼地牢 · 招式校准', 7, PAL.cyan, 'left', 1.0);
  uiText(20, 43, '训练场', 16, UC.parch);
  uiText(184, 23, '生命 ' + Math.round(P.hp) + '/' + CFG.hpMax + ' · 不死庇护 · Tab 切分类', 9.5, P.hp < CFG.hpMax ? PAL.gold : UC.mut);
  uiFrame(CFG.W - 150, 8, 48, 22, { fill: 'rgba(20,14,18,0.92)', accent: UC.brass, double: false });
  uiText(CFG.W - 126, 23, '暂停', 8.5, UC.parch, 'center');
  hitBox(CFG.W - 150, 8, 48, 22, () => setPaused(true));
  uiFrame(CFG.W - 94, 8, 84, 22, { fill: 'rgba(32,10,12,0.92)', accent: PAL.red, double: false });
  uiText(CFG.W - 52, 23, '离开训练场', 8.5, PAL.red, 'center');
  hitBox(CFG.W - 94, 8, 84, 22, leaveTraining);

  const bossActive = !!(S.boss && !S.boss.dead && S.arena && S.arena.active);
  if (bossActive) {
    const b = S.boss, meta = BOSS_META[b.bkind] || BOSS_META.colossus;
    uiFrame(10, 56, CFG.W - 20, 24, { fill: 'rgba(16,9,12,0.94)', accent: meta.c, top: meta.c });
    uiText(22, 72, '试炼封印 · ' + meta.title, 8.5, meta.c);
    uiSeg(204, 66, CFG.W - 300, 5, b.hp / b.max, meta.c, 8);
    uiNum(CFG.W - 22, 72, Math.max(0, S.arena.timeLeft).toFixed(1) + 's', 8.5, PAL.gold, 'right', '700');
  } else if (S.dummy) {
    const bx = 10, by = 56, bw = 350, bh = 34, st = S.trainingStats;
    uiFrame(bx, by, bw, bh, { fill: 'rgba(16,11,14,0.92)', accent: PAL.gold, top: PAL.gold });
    uiText(bx + 10, by + 15, '木偶 ' + Math.max(0, Math.round(S.dummy.hp)) + '/' + S.dummy.max, 8.5, PAL.gold);
    uiSeg(bx + 112, by + 10, 120, 4, S.dummy.hp / S.dummy.max, PAL.gold, 6);
    let dps = 0;
    if (st) { const win = st.time - 5; let sum = 0, first = st.time; for (const q of st.marks || []) if (q.t >= win) { sum += q.v; if (q.t < first) first = q.t; } if (sum > 0) dps = sum / Math.min(5, Math.max(0.5, st.time - first)); }
    uiText(bx + 10, by + 29, '5s伤害 ' + dps.toFixed(1) + ' · 总伤害 ' + (st ? st.dmg : 0) + ' · 命中 ' + (st ? st.hits : 0), 8, UC.bone);
  }

  if (bossActive) {
    uiFrame(CFG.W - 256, 8, 98, 22, { fill: 'rgba(20,15,18,0.92)', accent: PAL.gold, double: false });
    uiText(CFG.W - 207, 23, '训练工具', 9, PAL.gold, 'center');
    hitBox(CFG.W - 256, 8, 98, 22, () => { S.trainToolsOpen = true; clearGameplayInput(); });
  } else {
    uiButton(380, 92, 132, 38, { title: '训练工具', sub: useTouch() ? '武器 / 怪物 / 机关' : 'Tab 打开', c: PAL.gold, size: 12 });
    hitBox(380, 92, 132, 38, () => { S.trainToolsOpen = true; clearGameplayInput(); });
    const key = P.slot === 0 ? P.weapon.melee : P.weapon.ranged;
    uiText(20, 105, '当前：' + WEAP[key].name + (P.slot === 0 ? ' · 近战' : ' · 远程'), 9, UC.bone);
  }
  drawHUDToasts();
  drawFloatTouch();
}

const settingsPanel = document.getElementById('settings-panel');
const portraitMenu = document.getElementById('portrait-menu');
const bindingButtons = new Map();
let settingsReturnFocus = null;
function syncTouchButtons() {
  for (const b of touchKeys) {
    const id = b.dataset.touch;
    const held = [...ptr.values()].some(s => s.kind === 'btn' && s.id === id);
    if (b.classList.contains('held') !== held) b.classList.toggle('held', held);
    if (id === 'weapon') {
      const hide = P.owned[P.slot === 0 ? 'melee' : 'ranged'].length < 2;
      if (b.hidden !== hide) b.hidden = hide;
    }
    if (id === 'atk') {
      const label = S.hall ? '进' : '攻';
      if (b.textContent !== label) {
        b.textContent = label;
        b.setAttribute('aria-label', S.hall ? '入门整备出征' : '攻击');
      }
    }
    if (id === 'slot') {
      const label = P.slot === 0 ? '远程' : '近战';
      if (b.textContent !== label) {
        b.textContent = label;
        b.setAttribute('aria-label', '切换到' + label);
      }
    }
  }
}
function nativeButton(parent, label, action, primary) {
  const b = document.createElement('button'); b.type = 'button'; b.textContent = label;
  if (primary) b.className = 'primary';
  b.addEventListener('click', () => { audioInit(); action(); clearGameplayInput(); syncNativeUI(); });
  parent.append(b); return b;
}
function syncPortraitMenu() {
  const portrait = !ORIENT.forced && innerWidth <= 560 && innerHeight > innerWidth;
  const trainingTools = S.training && S.trainToolsOpen;
  const show = !S.settingsOpen && (trainingTools || (portrait && (S.screen !== 'playing' || S.hall || S.paused || S.helpOpen || S.guideOpen || S.loadout || S.shopOpen || S.bossRewardOpen || S.panel)));
  portraitMenu.hidden = !show;
  if (!show) { portraitMenu.dataset.view = ''; return false; }
  const signature = JSON.stringify([S.screen, S.menuPage, S.hall, S.paused, S.helpOpen, S.guideOpen, S.guidePage, S.loadout, S.shopOpen, S.bossRewardOpen, S.panel, S.meta.marks, S.meta.hammer, S.meta.orb, S.meta.ember, S.meta.slot, S.meta.revive, S.coins, P.hp, S.difficulty, trainingTools, S.trainTab, P.weapon.melee, P.weapon.ranged]);
  if (portraitMenu.dataset.view === signature) return true;
  portraitMenu.dataset.view = signature;
  const body = document.getElementById('portrait-content'); body.replaceChildren();
  const text = (value, heading) => { const el = document.createElement(heading ? 'h2' : 'p'); el.textContent = value; body.append(el); };
  const back = () => { S.menuPage = 'home'; };
  if (S.guideOpen || S.helpOpen) {
    if (S.guideOpen) {
      const page = GUIDE_PAGES[S.guidePage]; text(page.title, true); page.lines.forEach(line => text(line));
      nativeButton(body, '上一页', () => { S.guidePage = Math.max(0, S.guidePage - 1); });
      nativeButton(body, S.guidePage === GUIDE_PAGES.length - 1 ? '完成' : '下一页', () => { if (S.guidePage === GUIDE_PAGES.length - 1) S.guideOpen = false; else S.guidePage++; }, true);
      nativeButton(body, '返回', () => { S.guideOpen = false; });
    } else {
      text('操作说明', true); text('目标是持续向上：左摇杆滑动移动、上推跳，右手攻击、闪避，点击近战 / 远程切换攻击类型。');
      for (const a of BIND_ORDER) text(BIND_LABELS[a] + '：' + bindingText(a));
      nativeButton(body, '返回', closeHelp, true);
    }
  } else if (S.loadout) {
    text('出征整备', true); text('选择一把近战与一把远程武器。');
    for (const col of [0, 1]) {
      const label = document.createElement('label'); label.textContent = col === 0 ? '近战武器' : '远程武器';
      const select = document.createElement('select'); select.setAttribute('aria-label', label.textContent);
      for (const k of loadoutList(col)) { const o = document.createElement('option'); o.value = k; o.textContent = WEAP[k].name; select.append(o); }
      select.value = S.loadout.picks[col === 0 ? 'melee' : 'ranged'];
      select.addEventListener('change', () => { pickLoadout(select.value); });
      label.append(select); body.append(label);
    }
    nativeButton(body, '就此出征', confirmLoadout, true); nativeButton(body, '返回', cancelLoadout);
  } else if (S.bossRewardOpen) {
    text('镇楼赐福', true);
    for (let i = 0; i < S.bossRewards.length; i++) { const r = S.bossRewards[i]; nativeButton(body, r.title + ' · ' + r.desc, () => chooseBossReward(i)); }
  } else if (S.shopOpen) {
    text('黑市契约', true); text('金币 ' + S.coins);
    shopOffers().forEach((o, i) => { const b = nativeButton(body, o.name + ' · ' + o.cost + ' 金币', () => buyOffer(i)); b.disabled = !o.ok || S.coins < o.cost; });
    nativeButton(body, '继续攀登', () => { S.shopOpen = false; }, true);
  } else if (S.panel) {
    text('角色画卷', true); text('生命 ' + Math.round(P.hp) + '/' + CFG.hpMax + ' · 金币 ' + S.coins + ' · 功绩 ' + S.score);
    text('近战：' + WEAP[P.weapon.melee].name + ' · 远程：' + WEAP[P.weapon.ranged].name);
    text('符文：' + (P.runes.map(r => RUNE_NAME[r]).join('、') || '暂无'));
    nativeButton(body, '返回', () => { S.panel = false; }, true);
  } else if (S.paused) {
    text(S.training ? '试炼暂停' : '攀登暂停', true);
    nativeButton(body, '继续游戏', () => setPaused(false), true);
    nativeButton(body, '音乐', () => openSettings('pause', 'music'));
    nativeButton(body, '操控与键位', () => openSettings('pause', 'controls'));
    nativeButton(body, '操作说明', () => { S.helpOpen = true; });
    if (S.training) {
      nativeButton(body, '训练工具', () => { setPaused(false); S.trainToolsOpen = true; });
      nativeButton(body, '清场重置', () => { setPaused(false); resetDummy(); });
      nativeButton(body, '离开训练场', leaveTraining);
    } else {
      nativeButton(body, '角色画卷', () => { S.panel = true; });
      nativeButton(body, '返回标题', () => { S.paused = false; S.hall = false; S.screen = 'menu'; S.menuPage = 'home'; });
    }
  } else if (trainingTools) {
    text('训练工具', true); text('调整时战斗暂停，选择后返回试炼。');
    nativeButton(body, '收起工具 · 返回试炼', () => { S.trainToolsOpen = false; }, true);
    for (const [id, label] of [['weapons','武器'],['monsters','怪物'],['traps','机关']]) nativeButton(body, (S.trainTab === id ? '当前 · ' : '') + label, () => { S.trainTab = id; });
    if (S.trainTab === 'weapons') for (const k of trainWeaponKeys()) nativeButton(body, WEAP[k].name, () => { trainingSelect(k); S.trainToolsOpen = false; });
    else if (S.trainTab === 'monsters') for (const k of TRAIN_MONS) nativeButton(body, MON_META[k].name, () => { trainingSpawn(k); S.trainToolsOpen = false; });
    else for (const k of TRAP_KINDS) nativeButton(body, TRAP_META[k].name, () => { trainingTrap(k); S.trainToolsOpen = false; });
    nativeButton(body, '试炼 Boss', () => { trainingBoss(); S.trainToolsOpen = false; });
    nativeButton(body, '清场重置', () => { resetDummy(); S.trainToolsOpen = false; });
  } else if (S.hall || S.menuPage === 'select') {
    text('选择魔塔', true); text('向上攀登、躲开危险；进入后只需先学会走、跳、攻击。');
    for (const [id, label] of [['easy','轻松'],['normal','标准'],['hard','困难'],['hell','超级困难']]) nativeButton(body, (S.difficulty === id ? '当前 · ' : '') + label, () => setDifficulty(id));
    for (const m of ['endless','limited','daily']) nativeButton(body, modeMeta(m).name, () => openLoadout(m, S.hall ? 'hall' : 'menu'), m === 'endless');
    nativeButton(body, '返回主页', () => { S.hall = false; S.screen = 'menu'; S.menuPage = 'home'; });
  } else if (S.screen === 'dead') {
    text('本局结束', true); text('最高到达 ' + S.finalBest + ' 层');
    nativeButton(body, '再战一局', () => openLoadout(S.mode, 'dead'), true); nativeButton(body, '返回门厅', startHall);
  } else if (S.menuPage === 'unlock') {
    text('印记解锁', true); text('可用印记 ' + S.meta.marks);
    for (const [k, cost, label] of [['hammer',30,'震岳铁锤'],['orb',50,'湮灭法球'],['slot',40,'符文槽 +1'],['revive',60,'印记复生']]) {
      const info = achInfo(k); const owned = !!S.meta[k];
      const b = nativeButton(body, label + (owned ? ' · 已拥有' : ' · ' + cost + ' 印记'), () => buyMeta(k, cost, label));
      b.disabled = owned || S.meta.marks < cost || !!(info && !info.done);
      if (info && !info.done) text('需达成：' + info.name);
    }
    nativeButton(body, '返回主页', back);
  } else if (S.menuPage === 'learn') {
    text('学习与练习', true); text('可以直接开始游戏，这些内容随时回来查询。');
    nativeButton(body, '操作说明', () => { S.helpOpen = true; });
    nativeButton(body, '新手引导', () => { S.guideOpen = true; S.guidePage = 0; });
    nativeButton(body, '训练场', startTraining); nativeButton(body, '返回主页', back);
  } else {
    text('向上才是唯一方向', true); text('先学走、跳、攻击，其余技巧边玩边学。横屏可获得更开阔的战斗视野。');
    nativeButton(body, '开始游戏', startHall, true);
    nativeButton(body, '设置 · 音乐与操控', () => openSettings('menu'));
    nativeButton(body, '印记解锁', () => { S.menuPage = 'unlock'; });
    nativeButton(body, '学习与练习', () => { S.menuPage = 'learn'; });
    text('最高 ' + S.meta.best + ' 层 · 印记 ' + S.meta.marks);
  }
  return true;
}
function syncNativeUI() {
  settingsPanel.hidden = !S.settingsOpen;
  if (S.settingsOpen) {
    const music = S.settingsTab === 'music';
    document.getElementById('music-settings').hidden = !music;
    document.getElementById('control-settings').hidden = music;
    for (const b of settingsPanel.querySelectorAll('[data-settings-tab]')) b.setAttribute('aria-selected', String(b.dataset.settingsTab === S.settingsTab));
    for (const [key, title, value, on] of [['sound', '音效', getSoundVolume(), S.meta.sound !== false], ['bgm', '背景音乐', getBgmVolume(), S.meta.bgm !== false]]) {
      const toggle = document.getElementById(key + '-toggle');
      toggle.textContent = title + '：' + (on ? '开' : '关'); toggle.setAttribute('aria-pressed', String(on));
      document.getElementById(key + '-volume').value = Math.round(value * 100);
      document.getElementById(key + '-percent').textContent = Math.round(value * 100) + '%';
    }
    document.getElementById('control-mode').value = S.meta.controlMode || 'auto';
    const ss = Math.max(84, Math.min(176, Math.round(S.meta.stickSize || 132)));
    document.getElementById('stick-size').value = ss;
    document.getElementById('stick-size-out').textContent = ss;
    document.getElementById('stick-origin').value = S.meta.stickOrigin || 'float';
    document.getElementById('binding-message').textContent = S.bindingError || (S.keyCapture ? '请按一个新键；Esc 取消，也可再次点击该动作取消。' : '点击动作改绑；保留键和重复键不可用，修改自动保存。');
    for (const [a, b] of bindingButtons) { b.classList.toggle('capturing', S.keyCapture === a); b.lastElementChild.textContent = S.keyCapture === a ? '按下新键…' : bindingText(a); }
  }
  const portrait = syncPortraitMenu();
  touchLayer.hidden = !useTouch() || gameplayInputBlocked() || portrait || (S.training && S.trainToolsOpen);
  if (touchLayer.hidden) stickReset();
  syncTouchButtons();
  return S.settingsOpen || portrait;
}
for (const a of BIND_ORDER) {
  const b = document.createElement('button'); b.type = 'button'; b.dataset.binding = a;
  const label = document.createElement('span'); label.textContent = BIND_LABELS[a];
  const key = document.createElement('span'); key.className = 'binding-key'; b.append(label, key);
  b.addEventListener('click', () => { S.keyCapture = S.keyCapture === a ? null : a; S.bindingError = ''; syncNativeUI(); });
  document.getElementById('binding-list').append(b); bindingButtons.set(a, b);
}
for (const b of settingsPanel.querySelectorAll('[data-settings-tab]')) b.addEventListener('click', () => { S.settingsTab = b.dataset.settingsTab; S.keyCapture = null; S.bindingError = ''; syncNativeUI(); });
document.getElementById('settings-close').addEventListener('click', closeSettings);
document.getElementById('sound-toggle').addEventListener('click', () => { audioInit(); toggleSound(); syncNativeUI(); });
document.getElementById('bgm-toggle').addEventListener('click', () => { audioInit(); toggleBgm(); syncNativeUI(); });
document.getElementById('sound-volume').addEventListener('input', e => { audioInit(); setSoundVolume(Number(e.target.value) / 100); syncNativeUI(); });
document.getElementById('bgm-volume').addEventListener('input', e => { audioInit(); setBgmVolume(Number(e.target.value) / 100); syncNativeUI(); });
document.getElementById('control-mode').addEventListener('change', e => { S.meta.controlMode = e.target.value; clearGameplayInput(); saveMeta(); syncNativeUI(); });
document.getElementById('stick-size').addEventListener('input', e => {
  S.meta.stickSize = Number(e.target.value);
  saveMeta(); applyStickSize();
  document.getElementById('stick-size-out').textContent = e.target.value;
});
applyStickSize();
document.getElementById('stick-origin').addEventListener('change', e => {
  S.meta.stickOrigin = e.target.value;
  saveMeta(); stickReset();
});
document.getElementById('bindings-reset').addEventListener('click', () => { resetBindings(); syncNativeUI(); });
/* ---------- 面板触摸拖拽滚动：真机在旋转 fixed 容器内原生触摸滚动不可靠，改 1:1 指针驱动 ---------- */
for (const panel of [settingsPanel, portraitMenu]) {
  let drag = null, swallowClick = false;
  panel.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch') return;
    swallowClick = false;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, top: panel.scrollTop, moved: false };
  });
  panel.addEventListener('pointermove', e => {
    if (!drag || drag.id !== e.pointerId) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    const d = !ORIENT.forced ? dy : ORIENT.dir > 0 ? -dx : dx;
    if (!drag.moved && Math.abs(d) < 8) return;
    drag.moved = true;
    swallowClick = true;
    panel.scrollTop = drag.top - d;
    e.preventDefault();
  });
  const dragEnd = e => { if (drag && drag.id === e.pointerId) { swallowClick = drag.moved; drag = null; } };
  panel.addEventListener('pointerup', dragEnd);
  panel.addEventListener('pointercancel', dragEnd);
  panel.addEventListener('click', e => {
    if (swallowClick) { swallowClick = false; e.stopPropagation(); e.preventDefault(); }
  }, true);
}
settingsPanel.addEventListener('keydown', e => {
  if (e.key !== 'Tab') return;
  const list = [...settingsPanel.querySelectorAll('button,input,select')].filter(el => el.getClientRects().length && !el.disabled);
  const first = list[0], last = list[list.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});
/* ---------- 全局 UI 入口与说明弹窗控制 ---------- */
function drawUILayer() {
  U.setTransform(US, 0, 0, US, 0, 0);
  U.clearRect(0, 0, CFG.W, CFG.H);
  S.hit.length = 0;
  if (syncNativeUI()) return;
  if (CFG.W >= 500) {
    if (S.guideOpen) { drawGuideWide(); return; }
    if (S.loadout) { S.hit.length = 0; drawLoadoutWide(); return; }
    if (S.hall && !S.paused && !S.helpOpen) { drawHallHUD(); return; }
    if (S.helpOpen) { drawHelpWide(); return; }
    if (S.screen === 'playing') {
      if (S.training) drawTrainingHUDWide();
      else drawHUDWide();
      if (S.panel) { S.hit.length = 0; drawPanelWide(); }
      else if (S.bossRewardOpen) { S.hit.length = 0; drawBossRewardWide(); }
      else if (S.shopOpen) { S.hit.length = 0; drawShopWide(); }
      else if (S.paused) { S.hit.length = 0; drawPauseWide(); }
    } else if (S.screen === 'dead') drawDeadWide();
    else if (S.menuPage === 'select') drawSelectWide();
    else if (S.menuPage === 'unlock') drawUnlockWide();
    else if (S.menuPage === 'learn') drawLearnWide();
    else drawMenuWide();
    return;
  }
  if (S.helpOpen) { drawHelp(); return; }
  if (S.screen === 'playing') {
    if (S.training && S.paused) { S.hit.length = 0; drawTrainingPause(); }
    else {
      if (S.training) drawTrainingHUD();
      else drawHUD();
      if (S.panel) { S.hit.length = 0; drawPanel(); }
      else if (S.bossRewardOpen) { S.hit.length = 0; drawBossReward(); }
      else if (S.shopOpen) { S.hit.length = 0; drawShop(); }
      else if (S.paused) { S.hit.length = 0; drawPause(); }
    }
  } else if (S.screen === 'dead') drawDead();
  else if (S.menuPage === 'select') drawSelect();
  else if (S.menuPage === 'unlock') drawUnlock();
  else drawMenu();
}

function closeHelp() { S.helpOpen = false; if (!S.meta.seenHelp) { S.meta.seenHelp = true; saveMeta(); } if (S.screen === 'playing' && !S.dead) weaponHint(P.slot); }
function openSettings(from, tab) {
  settingsReturnFocus = document.activeElement;
  S.settingsFrom = from || 'menu'; S.settingsTab = tab || 'music';
  S.settingsOpen = true; S.keyCapture = null; S.bindingError = '';
  clearGameplayInput(); sfx('ui'); syncNativeUI();
  document.getElementById('settings-close').focus();
}
function closeSettings() {
  S.settingsOpen = false; S.keyCapture = null; S.bindingError = '';
  clearGameplayInput(); sfx('ui'); syncNativeUI();
  if (settingsReturnFocus && settingsReturnFocus.isConnected) settingsReturnFocus.focus();
}
/* ---------- 循环 ---------- */
let last = performance.now(), acc = 0, fpsT = 0, fpsN = 0, bootFaultShown = false;
function loop(now) {
  let bootCrash = null;
  try {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    fpsT += dt; fpsN++;
    if (fpsT > 0.5) {
      S.fps = Math.round(fpsN / fpsT); fpsT = 0; fpsN = 0;
      if (S.fps < 45) { lowStreak++; } else lowStreak = 0;
      if (lowStreak >= 3 && WS > 2) { lowStreak = 0; setScale(WS - 1); toast('帧率不足，渲染降至 ×' + WS, PAL.mut); }
    }
    acc += dt;
    while (acc >= 1 / 60) { update(1 / 60); acc -= 1 / 60; }
    render();
    document.getElementById('dbg').textContent =
      'fps ' + S.fps + '  层 ' + Math.max(0, Math.floor(-P.y / CFG.FH)) +
      '\n死 ' + S.deaths + ' 杀 ' + S.kills + ' 重开 ' + (S.restartFrames / 60).toFixed(2) + 's' +
      '\n崩落 ' + (S.collapseOn ? 'on' : (CFG.collapseDelay - S.t).toFixed(1) + 's');
    if (!window.__gameReady) window.__gameReady = true;
  } catch (err) {
    const detail = err && (err.stack || err.message) || String(err);
    if (S.errors.length < 200) S.errors.push(detail);
    if (!window.__gameReady) {
      if (!bootFaultShown) { bootFaultShown = true; bootCrash = err; }
    } else if (!S.runtimeErrorLogged) {
      S.runtimeErrorLogged = true;
      try { console.error('[游戏运行异常]', err); } catch (_) {}
    }
  }
  requestAnimationFrame(loop);
  if (bootCrash) setTimeout(() => { throw bootCrash; }, 0);
}
addEventListener('error', e => S.errors.push(String(e.message)));
/* 启动：进入主菜单；世界在 startRun 时重置 */
requestAnimationFrame(loop);

/* ---------- 自检 API ---------- */
window.G = {
  CFG, S, P, IN, keys, WEAP, MON_META, TRAIN_MONS, TRAP_META, TRAP_KINDS, TRAP_DEBUT, TRAP_UNLOCK,
  BOSS_ORDER, BOSS_META, isBossFloor, isBossArenaUpper, bossKindForFloor, spawnBoss, startBossArena, trainingBoss, resolveBossVictory, resolveBossTimeout, chooseBossReward,
  render, spawnMonster, placeTrap,
  startRun() { startRun('endless'); return S.screen; },
  startHall() { startHall(); return { screen: S.screen, hall: S.hall }; },
  hallState() { return { hall: S.hall, x: P.x, near: S.hallNear, difficulty: S.difficulty, doors: HALL_DOORS.map(d => ({ mode: d.mode, x: d.x, name: d.name })) }; },
  setDifficulty(id) { return setDifficulty(id); },
  enterHall(i) { return enterHallDoor(i); },
  startMode(m) { startRun(m); return S.mode; },
  startTraining() { startTraining(); return { screen: S.screen, training: S.training, weapon: P.weapon.melee }; },
  trainingSelect(k) { trainingSelect(k); return P.weapon; },
  trainingSpawn(k) { return trainingSpawn(k); },
  trainingTrap(k) { trainingTrap(k); return S.trainTrap; },
  slashEnemyShots(w) { return slashEnemyShots(w || curWeap()); },
  enemyExplode(x, y, r, dmg, hp) { enemyExplode(x, y, r, dmg, hp); return S.eblasts.length; },
  resetDummy() { resetDummy(); return S.dummy ? S.dummy.hp : 0; },
  leaveTraining() { leaveTraining(); return S.screen; },
  trainingState() {
    return { training: S.training, dummy: S.dummy ? { x: S.dummy.x, y: S.dummy.y, hp: S.dummy.hp, max: S.dummy.max } : null,
      stats: S.trainingStats ? { dmg: S.trainingStats.dmg, hits: S.trainingStats.hits, last: S.trainingStats.last } : null,
      weapon: { ...P.weapon }, slot: P.slot, owned: { melee: [...P.owned.melee], ranged: [...P.owned.ranged] } };
  },
  endRun() { endRun('debug'); return S.screen; },
  meta() { return S.meta; },
  orient() { return { forced: ORIENT.forced, dir: ORIENT.dir, lockTried: ORIENT.lockTried, sensorBound: ORIENT.sensorBound, innerW: innerWidth, innerH: innerHeight, bodyW: document.body.offsetWidth, bodyH: document.body.offsetHeight, viewScale: VIEW_SCALE, ws: WS, uiW: uiCv.width, uiH: uiCv.height }; },
  orientFlip() { ORIENT.dir = -ORIENT.dir; orientApply(); return ORIENT.dir; },
  orientSensorTest(gamma) { orientSensor({ gamma }); return ORIENT.dir; },
  audio() { return { ready: !!AUD.ctx, state: AUD.ctx ? AUD.ctx.state : 'none', sound: S.meta.sound !== false, bgm: S.meta.bgm !== false, soundVolume: getSoundVolume(), bgmVolume: getBgmVolume(), sfxGain: AUD.sfxBus ? AUD.sfxBus.gain.value : null, musicOn: !!MUS.timer, quiet: AUD.quiet, critical: [...SFX_CRITICAL], low: [...SFX_LOW], alertUntil: AUD.alertUntil, last: Object.assign({}, AUD.last) }; },
  setSound, getSoundVolume, getBgmVolume, setSoundVolume, setBgmVolume,
  music() {
    const track = MUS.track, file = MUS.fileAudio, starts = { menu: INTRO_START, climb: CLIMB_LOOP_START, boss: BOSS_LOOP_START };
    return { on: MUS.on, scheduler: !!MUS.timer, step: MUS.step, phase: MUS.phase, bgm: S.meta.bgm !== false,
      backend: track ? 'webaudio' : (file ? 'audio-element' : 'webaudio'),
      audioReady: track ? MUS.audioReady : (file ? MUS.fileReady : MUS.audioReady), loading: !!MUS.loading, error: MUS.error,
      audioPaused: track ? (!MUS.on || AUD.ctx.state !== 'running') : (file ? (!MUS.on || file.paused) : true),
      section: track ? track.key : (file ? MUS.fileSection : null),
      currentTime: track ? starts[track.key] + TRACK_SEAM + (AUD.ctx.currentTime - track.started) % track.source.buffer.duration : (file ? file.currentTime : null),
      volume: track ? (MUS.trackBus ? MUS.trackBus.gain.value : null) : (file ? file.volume : null), bgmVolume: getBgmVolume(),
      loopDuration: track ? track.source.buffer.duration : null, seamFade: TRACK_SEAM, sceneFade: TRACK_FADE,
      trackVoices: MUS.tracks.length, synthVoices: MUS.voices.length, fileFallback: !!file, fileReason: MUS.fileReason || null,
      failures: MUS.failures || [], fallback: MUS.on && !track && !file };
  },
  setBgm(on) { setBgm(on); return this.music(); },
  initAudio() { audioInit(); return this.audio(); },
  sfx(n) { sfx(n); return true; },
  toggleSound() { toggleSound(); return S.meta.sound; },
  toggleBgm() { toggleBgm(); return S.meta.bgm; },
  resetMeta() { S.meta = metaDefault(); S.difficulty = 'normal'; loadBindings(); saveMeta(); return S.meta; },
  bindings() { return { bind: JSON.parse(JSON.stringify(BIND)), mode: S.meta.controlMode || 'auto', useTouch: useTouch(), touchDetected, capture: S.keyCapture, settingsOpen: S.settingsOpen }; },
  assignBinding(a, k) { assignBinding(a, k); return BIND[a]; },
  resetBindings() { resetBindings(); return JSON.parse(JSON.stringify(BIND)); },
  openSettings(from) { openSettings(from); return S.settingsOpen; },
  closeSettings() { closeSettings(); return S.settingsOpen; },
  setControlMode(m) { S.meta.controlMode = m; saveMeta(); return { mode: m, useTouch: useTouch() }; },
  setTouchDetected(v) { touchDetected = !!v; return useTouch(); },
  touchButtons() { return touchButtonRects(); },
  shop() { return { open: S.shopOpen, offers: shopOffers().map(o => ({ name: o.name, cost: o.cost, ok: o.ok, reason: o.reason, desc: o.desc, permanent: !!o.permanent })), coins: S.coins, hp: P.hp, hpMax: CFG.hpMax, slots: CFG.runeSlots || 2 }; },
  buyOffer(i) { buyOffer(i); return this.shop(); },
  ach() { return Object.keys(ACH).map(k => achInfo(k)); },
  achDone(k) { return achDone(k); },
  buyUnlock(k, cost, label) { buyMeta(k, cost || 40, label || k); return { meta: S.meta, ach: achInfo(k) }; },
  openLoadout(m, from) { openLoadout(m, from); return this.loadoutState(); },
  loadoutState() {
    return { open: !!S.loadout, screen: S.screen, mode: S.loadout ? S.loadout.mode : null, from: S.loadout ? S.loadout.from : null,
      picks: S.loadout ? { ...S.loadout.picks } : null, col: S.loadout ? S.loadout.col : null, row: S.loadout ? S.loadout.row : null,
      pool: { melee: [...loadoutList(0)], ranged: [...loadoutList(1)] },
      equipped: { melee: P.weapon.melee, ranged: P.weapon.ranged }, owned: { melee: [...P.owned.melee], ranged: [...P.owned.ranged] } };
  },
  pickLoadout(k) { pickLoadout(k); return this.loadoutState(); },
  loadoutMove(c, r) { loadoutMove(c, r); return this.loadoutState(); },
  confirmLoadout() { confirmLoadout(); return { screen: S.screen, mode: S.mode, weapon: { ...P.weapon }, owned: { melee: [...P.owned.melee], ranged: [...P.owned.ranged] } }; },
  cancelLoadout() { cancelLoadout(); return { screen: S.screen, hall: S.hall, menuPage: S.menuPage, open: !!S.loadout }; },
  grantLoadoutWeapons(list) { (list || []).forEach(k => { if (WEAP[k]) S.meta[k] = true; }); saveMeta(); return this.loadoutState(); },
  daily() { const dp = dailyParts(); return { key: dp.key, seed: dailySeed(), str: dp.str, mon: dp.mon, dd: dp.dd, todayBest: dailyBest(), bestDaily: S.meta.bestDaily, rec: Object.assign({}, S.meta.dailyRec || {}) }; },
  final() { return { best: S.finalBest, deathFloor: S.finalDeathFloor, marks: S.runMarks, bestThisRun: S.bestThisRun, metaBest: S.meta.best, bestEndless: S.meta.bestEndless, bestLimited: S.meta.bestLimited, bestDaily: S.meta.bestDaily }; },
  ruleIds() { return RULES.map(r => r.id); },
  btns() { return touchKeys.map(b => b.dataset.touch); },
  deathReport() {
    const d = S.lastDamage && S.lastDamage.reason === S.deathReason ? S.lastDamage : null;
    const src = d ? d.srcTag : '';
    return { reason: S.deathReason, source: src, cause: reasonText(S.deathReason, src), advice: deathAdvice(S.deathReason, src),
      hitsTaken: S.hitsTaken || 0, deaths: S.deaths, best: S.finalBest, newRecord: !!S.finalNewRecord, marks: S.runMarks };
  },
  trainingTools() {
    return { tab: S.trainTab, tabs: TRAIN_TABS.map(t => t.id), bossActive: !!(S.boss && !S.boss.dead && S.arena && S.arena.active), paused: S.paused,
      visibleCategories: (S.boss && !S.boss.dead && S.arena && S.arena.active) || S.paused ? 0 : 1 };
  },
  audioPriority(name) { return { name, priority: SFX_CRITICAL.has(name) ? 3 : (SFX_LOW.has(name) ? 1 : 2), throttle: SFX_CRITICAL.has(name) ? (SFX_CRITICAL_THROTTLE[name] || 70) : (SFX_THROTTLE[name] || 0) }; },
  musicPhase() { return musicPhase(); },
  cycleTrainTab() { return cycleTrainTab(); },
  touchLayout() {
    const hitboxes = touchButtonRects().map(b => ({ ...b, radius: b.r, cssDiameter: b.r * 2 }));
    const overlaps = [];
    for (let i = 0; i < hitboxes.length; i++) for (let j = i + 1; j < hitboxes.length; j++) {
      const a = hitboxes[i], b = hitboxes[j];
      if (Math.hypot(a.x - b.x, a.y - b.y) < a.radius + b.radius) overlaps.push(a.id + '/' + b.id);
    }
    return { scale: +VIEW_SCALE.toFixed(3), activePointers: ptr.size, jumpHeld: IN.jumpHeld, atkHeld: IN.atkHeld, hitboxes, overlaps };
  },
  economyProbe() {
    const savedMeta = JSON.parse(JSON.stringify(S.meta));
    const savedScreen = S.screen, savedMode = S.mode, savedQuiet = AUD.quiet;
    const scenarios = [
      { id: 'fresh', best: 0, recordTier: 0, noviceGrant: false },
      { id: 'mid', best: 20, recordTier: 20, noviceGrant: true },
      { id: 'high', best: 80, recordTier: 80, noviceGrant: true },
    ];
    const out = [];
    AUD.quiet = true;
    for (const s of scenarios) {
      S.meta = Object.assign(JSON.parse(JSON.stringify(savedMeta)), { best: s.best, recordTier: s.recordTier, noviceGrant: s.noviceGrant, revive: false, hints: { tutDone: true } });
      startRun('endless');
      this.gotoFloor(10);
      this.step(2);
      const floorCoins = S.coins;
      const typicalIncome = 25; /* 约 6 只小怪 + 1 个金币箱；不含战祭坛/富裕规则 */
      const total = floorCoins + typicalIncome;
      out.push({ id: s.id, floorCoins, typicalIncome, total, affordableOffers: [20, 30, 40].filter(c => c <= total),
        canBuyHealAndAttack: total >= 50, noviceGrant: s.noviceGrant, recordTier: s.recordTier });
    }
    S.meta = savedMeta; saveMeta(); AUD.quiet = savedQuiet;
    startRun(savedMode || 'endless'); S.screen = savedScreen; S.menuPage = 'home';
    return out;
  },
  assets() { return { upper: UPPER_READY, cape: CAPE_READY, nohand: NOHAND_READY, hand: HAND_READY, lean6: LEAN6_READY, lean10: LEAN10_READY, lean12: LEAN12_READY, lean18: LEAN18_READY, legs: READY_LEG, atk: { ...ATK_READY }, death: DEATH_READY }; },
  setScale(n) { setScale(n); return WS; },
  quality() { return { WS, MAX_WS, DEVPX, fps: S.fps, backing: [document.getElementById('cv').width, document.getElementById('cv').height] }; },
  poseSheet() {
    const c = document.createElement('canvas'); c.width = 360; c.height = 640; c.id = 'sheet';
    const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
    g.fillStyle = '#12101d'; g.fillRect(0, 0, 360, 640);
    const saved = { anim: { ...P.anim }, weapon: { ...P.weapon }, slot: P.slot, lean: S.lean, dodgeT: P.dodgeT, hurtT: P.hurtT, slamT: P.slamT, slamLandT: P.slamLandT, sx: P.sx, sy: P.sy };
    const list = [
      ['idle', 0, 'knife', 0], ['idle', 0, 'long', 0], ['idle', 0, 'hammer', 0],
      ['idle', 0, 'crossbow', 1], ['idle', 0, 'orb', 1], ['run', 2, 'long', 0],
      ['run', 4, 'knife', 0], ['walk', 1, 'hammer', 0], ['jump', 1, 'long', 0],
      ['fall', 0, 'knife', 0], ['dodge', 1, 'long', 0], ['climb', 2, 'knife', 0],
      ['wallslide', 0, 'long', 0], ['hurt', 1, 'long', 0], ['slam', 0, 'hammer', 0],
      ['attack', 1, 'knife', 0], ['attack', 1, 'long', 0], ['attack', 2, 'hammer', 0],
      ['attack', 1, 'crossbow', 1], ['attack', 1, 'orb', 1], ['dead', 2, 'knife', 0],
    ];
    list.forEach(([st, f, w, sl], i) => {
      const col = i % 3, row = Math.floor(i / 3);
      const x = 60 + col * 120, y = 52 + row * 88;
      P.slot = sl;
      if (sl === 0) P.weapon.melee = w; else P.weapon.ranged = w;
      P.anim = { st, t: f * 0.1, f, runPhase: 0, atk: st === 'attack' ? 0.12 : 0, atkDur: 0.3, atkW: w };
      S.lean = (st === 'run' || st === 'dodge') ? 1 : st === 'walk' ? 0.52 : (st === 'jump' ? 0.35 : 0);
      P.dodgeT = st === 'dodge' ? CFG.dodge.dur * 0.55 : 0;
      P.hurtT = st === 'hurt' ? 0.18 : 0;
      P.slamT = st === 'slam' ? 0.10 : 0; P.slamLandT = 0; P.sx = 1; P.sy = 1;
      if (st === 'dead') { if (DEATH_READY >= 4) drawHeroAI(g, x, y, 2, 1, 0, DEATH_IMGS); }
      else drawRunHybrid(g, x, y, P.anim, 1);
      g.fillStyle = '#8f8ab0'; g.font = '8px monospace'; g.fillText(st + ' ' + f + ' ' + w, x - 34, y + 40);
    });
    P.anim = saved.anim; P.weapon = saved.weapon; P.slot = saved.slot; S.lean = saved.lean;
    P.dodgeT = saved.dodgeT; P.hurtT = saved.hurtT; P.slamT = saved.slamT; P.slamLandT = saved.slamLandT; P.sx = saved.sx; P.sy = saved.sy;
    c.style.cssText = 'position:fixed;left:8px;top:8px;z-index:99;box-shadow:0 0 0 2px #4cc9f0';
    document.body.appendChild(c);
    return true;
  },
  clearPoseSheet() { const c = document.getElementById('sheet'); if (c) c.remove(); return true; },
  debugRule(id) {
    const r = RULES.find(x => x.id === id); if (!r) return null;
    const pf = Math.max(0, Math.floor(-P.y / CFG.FH));
    S.rule = r; S.zone = { from: pf + 1, to: pf + 9 };
    S.ruleMul = r.id === 'fast' ? 1.3 : 1; S.dark = r.id === 'dark'; S.richZone = r.id === 'rich';
    applyZone(pf + 1, pf + 9, r);
    if (r.id === 'rich') S.chests.push({ x: CFG.W / 2, y: floorY(pf + 5) - CFG.platT - 10, floor: pf + 5, opened: false, t: 0 });
    return r.id;
  },
  buy(i) { buyOffer(i); return S.coins; },
  closeShop() { S.shopOpen = false; },
  pause(on) { return setPaused(on === undefined ? true : on, true); },
  togglePause() { return togglePause(); },
  gotoMenu() { setPaused(false, true); S.screen = 'menu'; S.menuPage = 'home'; },
  die() { die(); },
  metrics() {
    return { fps: S.fps, floor: Math.max(0, Math.floor(-P.y / CFG.FH)), best: S.bestThisRun, deaths: S.deaths, kills: S.kills,
      restartSec: S.restartFrames / 60, collapseOn: S.collapseOn, errors: S.errors, frames: S.frames };
  },
  step(n) { for (let i = 0; i < n; i++) update(1 / 60); },
  debugAddXp(n) { gainXp(n); return { lv: P.lv, atkMul: P.atkMul, spdMul: P.spdMul, hpMax: CFG.hpMax, hp: P.hp }; },
  debugHit(dmg) { hurtFeedback(dmg, 'contact'); return { hp: P.hp, floats: S_FLOAT.length }; },
  /* 武器操作/输入缓冲探针：回报冷却、缓冲、出手动画与一次性提示状态 */
  atk() {
    return { slot: P.slot, weapon: P.slot === 0 ? P.weapon.melee : P.weapon.ranged, cd: +P.atkCd.toFixed(3), buf: +P.atkBuf.toFixed(3),
      count: P.atkCount, animAtk: +P.anim.atk.toFixed(3), animDur: +P.anim.atkDur.toFixed(3), pending: !!P.atkPending,
      hints: Object.assign({}, S.meta.hints || {}), toasts: S.toasts.map(t => t.txt) };
  },
  attack() { doAttack(); return this.atk(); },
  swapSlot() { IN.slotSwap = true; return true; },
  tut() {
    if (!S.tut) return null;
    return { on: S.tut.on, step: S.tut.step, t: +S.tut.t.toFixed(2), moved: S.tut.moved, jumped: S.tut.jumped,
      attacked: S.tut.attacked, dj: S.tut.dj, dodged: S.tut.dodged, done: !!(S.meta.hints && S.meta.hints.tutDone),
      collapseOn: S.collapseOn, collapseIn: S.collapseOn ? 0 : +(CFG.collapseDelay - S.t).toFixed(2), toasts: S.toasts.map(t => t.txt) };
  },
  pact() {
    if (!S.pact) return null;
    return { floor: S.pact.floor, x: S.pact.x, y: S.pact.y, state: S.pact.state, left: S.pact.left, t: +S.pact.t.toFixed(2),
      failed: !!S.pact.failed, near: pactNear(), furyT: +P.furyT.toFixed(1), runes: P.runes.slice(), coins: S.coins, hp: P.hp,
      collapseOn: S.collapseOn, collapseY: +S.collapseY.toFixed(1) };
  },
  pactActivate() { return activatePact(); },
  gotoFloor(n) {
    P.y = floorY(n) - P.h / 2 - 1; P.vy = 0; P.vx = 0; P.onGround = true;
    ensureFloors(n + 6);
    return { y: P.y, floor: Math.max(0, Math.floor(-P.y / CFG.FH)) };
  },
  /* 受伤反馈一致性探针：逐来源触发统一入口，回报血条/闪烁/无敌帧/受伤音/来源飘字 */
  hurtTest(reason, dmg, srcTag) {
    P.iframe = 0; P.dead = false; if (P.hp < 40) P.hp = 100;
    const hp0 = P.hp, fBefore = S_FLOAT.length; AUD.last.hurt = 0;
    const applied = damagePlayer(dmg === undefined ? 15 : dmg, undefined, undefined, reason, srcTag);
    const lf = S_FLOAT.length > fBefore ? S_FLOAT[S_FLOAT.length - 1] : null;
    return { reason, applied, hp0, hp: P.hp, delta: hp0 - P.hp, hurtT: +P.hurtT.toFixed(2), iframe: +P.iframe.toFixed(2),
      hurtSfx: (AUD.last.hurt || 0) > 0, float: lf ? lf.txt : null, floatColor: lf ? lf.c : null, flash: +S.flash.toFixed(2), shake: S.shake };
  },
  /* 蓝台探针：强制触发噬血蓝台扣血路径（无无敌帧设计），回报基础反馈是否齐全 */
  blueTest() {
    P.iframe = 0; P.dead = false; if (P.hp < 40) P.hp = 100;
    const hp0 = P.hp, fBefore = S_FLOAT.length; AUD.last.hurt = 0;
    hurtFeedback(15, 'blue', { srcTag: '蓝', color: PAL.cyan, hurtT: 0.22 });
    const lf = S_FLOAT.length > fBefore ? S_FLOAT[S_FLOAT.length - 1] : null;
    return { hp0, hp: P.hp, delta: hp0 - P.hp, hurtT: +P.hurtT.toFixed(2), iframe: +P.iframe.toFixed(2),
      hurtSfx: (AUD.last.hurt || 0) > 0, float: lf ? lf.txt : null, floatColor: lf ? lf.c : null, flash: +S.flash.toFixed(2), shake: S.shake };
  },
  unlockWeapon(name) { const s = WEAP[name].slot; if (!P.owned[s].includes(name)) P.owned[s].push(name); P.weapon[s] = name; P.drawWeapT = 0.18; P.sheatheT = 0; return P.owned; },
  giveRune(id) { return addRune(id); },
  state() { return { paused: S.paused, hp: P.hp, hpMax: CFG.hpMax, lv: P.lv, runes: P.runes.slice(), weapon: { ...P.weapon }, chests: S.chests.length, opened: S.chests.filter(c => c.opened).length, pickups: S.pickups.map(u => u.id), bossHp: S.boss ? S.boss.hp : null, collapseMul: S.collapseMul, score: S.score, coins: S.coins }; },
  /* 楼梯可达性审计：全局攀爬链（落脚台→台阶1→2→3→下一层落脚台）逐节点检查 */
  auditFloors(n) {
    if (S.screen !== 'playing' || S.training) startRun('endless');
    ensureFloors(n);
    const chain = [];
    for (let i = 0; i <= n; i++) {
      const f = S.floors.get(i); if (!f) continue;
      const land = f.plats.find(p => p.landing);
      const landTag = (f.bossFloor ? 'B' : f.arenaUpper ? 'A' : 'L') + i;
      chain.push({ x: land.x + land.w / 2, w: land.w, y: land.y, tag: landTag });
      for (const p of f.plats.filter(p => !p.landing && !p.arenaWing && !p.branch).sort((a, b) => b.y - a.y))
        chain.push({ x: p.x + p.w / 2, w: p.w, y: p.y, tag: 'S' + i + '-' + (p.step || 0) });
    }
    const bad = [];
    for (let k = 1; k < chain.length; k++) {
      const a = chain[k - 1], b = chain[k];
      const dy = a.y - b.y;
      const aL = a.x - a.w / 2, aR = a.x + a.w / 2, bL = b.x - b.w / 2, bR = b.x + b.w / 2;
      const dx = Math.max(0, aL - bR, bL - aR);
      const bossLeap = (/^[BA]/.test(a.tag) || /^[BA]/.test(b.tag)) && dy <= 110;
      if ((dy > 52 && !bossLeap) || dy < 16 || (dy > 28 && dx > 120) || dx > 150)
        bad.push({ from: a.tag, to: b.tag, dy, dx: Math.round(dx) });
    }
    return { nodes: chain.length, bad };
  },
  testFirstKill() {
    if (S.screen !== 'playing') startRun('endless');
    AUD.quiet = true;
    S.monsters.push({ kind: 'wisp', x: P.x + 40, y: P.y - 6, x0: P.x + 40, y0: P.y - 6, hp: 20, dmg: 8, t: 0, flash: 0, dead: false });
    S.autoAttack = true;
    const k0 = S.kills; let n = 0;
    while (n < 240 && S.kills === k0) { update(1 / 60); n++; }
    S.autoAttack = false; AUD.quiet = false;
    return { killed: S.kills > k0, frames: n };
  },
  testRestart() {
    const old = S.meta.revive; S.meta.revive = true;
    startRun('endless'); S.reviveUsed = false;
    die('debug');
    let n = 0; while (n < 120 && P.dead) { update(1 / 60); n++; }
    const res = { frames: n, sec: +(n / 60).toFixed(2), revived: S.screen === 'playing' };
    S.meta.revive = old;
    return res;
  },
  testWallGrab() {
    if (S.screen !== 'playing') startRun('endless');
    ensureFloors(6);
    if (!P.runes.includes('climb')) P.runes.push('climb');
    const fl = S.floors.get(3);
    for (const p of fl.plats) p.type = 'norm';
    P.dead = false; P.x = (fl.wall === 'L' ? CFG.wallT : CFG.W - CFG.wallT) + (fl.wall === 'L' ? P.w / 2 + 1 : -P.w / 2 - 1);
    P.y = floorY(3) - 60; P.vy = 60; P.onGround = false; P.jumps = 2;
    keys[fl.wall === 'L' ? 'arrowleft' : 'arrowright'] = true;
    let sawWall = 0, sawClimb = false;
    for (let i = 0; i < 40; i++) { update(1 / 60); if (P.wall !== 0) sawWall++; if (P.climbing) sawClimb = true; }
    keys['arrowleft'] = false; keys['arrowright'] = false;
    return { wall: fl.wall, wallFrames: sawWall, climbed: sawClimb };
  },
  botStats(n, sec) {
    const runs = [];
    for (let i = 0; i < n; i++) { startRun('endless'); runs.push(this.botRun(sec)); }
    const avg = k => +(runs.reduce((a, b) => a + b[k], 0) / runs.length).toFixed(1);
    return { runs, avgFloors: avg('floors'), avgDeaths: avg('deaths'), avgFPM: avg('floorsPerMin') };
  },
  chain(upTo) {
    ensureFloors(upTo);
    const out = [];
    for (let i = 0; i <= upTo; i++) {
      const f = S.floors.get(i); if (!f) continue;
      const land = f.plats.find(p => p.landing);
      const standY = p => p.y - CFG.platT - P.h / 2 - 2;
      out.push({ x: land.x + land.w / 2, y: standY(land), floor: i });
      for (const p of f.plats.filter(p => !p.landing && !p.arenaWing && !p.branch).sort((a, b) => b.y - a.y))
        out.push({ x: p.x + p.w / 2, y: standY(p), floor: i });
    }
    return out;
  },
  /* 机器人玩家：用于平衡测量。返回 60 秒内的攀爬速度/死亡/击杀 */
  botRun(sec) {
    if (S.screen !== 'playing') startRun('endless');
    AUD.quiet = true;
    const nodes = this.chain(40);
    let ni = 0;
    const f0 = 0;
    const d0 = S.deaths, k0 = S.kills;
    const t0 = S.t;
    S.autoAttack = true;
    for (let n = 0; n < sec * 60; n++) {
      if (S.screen !== 'playing') break;
      if (S.bossRewardOpen) chooseBossReward(0);
      if (S.shopOpen) S.shopOpen = false;      /* bot 不买东西 */
      if (S.arena && S.arena.active && S.arena.boss && !S.arena.boss.dead) {
        const ab = S.arena.boss;
        const wantX = ab.x + (ab.x > CFG.W / 2 ? -34 : 34);
        const dxB = wantX - P.x;
        keys['arrowleft'] = dxB < -6; keys['arrowright'] = dxB > 6;
        if (P.onGround && (ab.y < P.y - 26 || n % 45 === 0)) { IN.jump = true; IN.jumpHeld = true; }
        if (n % 50 === 12) doDodge();
        update(1 / 60);
        continue;
      }
      if (ni < nodes.length - 1 && nodes[ni].y >= P.y - 4) ni++;
      const node = nodes[Math.min(ni, nodes.length - 1)];
      const dx = node.x - P.x;
      const ax = Math.max(-1, Math.min(1, dx / 22));
      keys['arrowleft'] = ax < -0.15; keys['arrowright'] = ax > 0.15;
      IN.touch = false;
      if (P.onGround && Math.abs(dx) < 34 && node.y < P.y - 6) { IN.jump = true; IN.jumpHeld = true; }
      else if (!P.onGround && P.vy > 40 && P.jumps < 2 && Math.abs(dx) < 26 && node.y < P.y - 30) { IN.jump = true; IN.jumpHeld = true; }
      else if (P.wall !== 0 && P.vy > 0) { IN.jump = true; IN.jumpHeld = true; }
      if (P.onGround && Math.abs(dx) < 6 && node.y >= P.y - 6) IN.jumpHeld = true;
      if (n % 9 === 0) IN.jumpHeld = P.vy < 0;
      update(1 / 60);
    }
    S.autoAttack = false; keys['arrowleft'] = false; keys['arrowright'] = false; IN.ax = 0; AUD.quiet = false;
    const mins = Math.max(0.01, (S.t - t0) / 60);
    const floors = Math.max(0, Math.floor(-P.y / CFG.FH)) - f0;
    return { floorsPerMin: +(floors / mins).toFixed(1), floors, deaths: S.deaths - d0, kills: S.kills - k0, sec: +(S.t - t0).toFixed(2), ended: S.screen !== 'playing', mode: S.mode };
  },
  /* 动作常数实测 */
  measureMoves() {
    if (S.screen !== 'playing') startRun('endless');
    const out = {};
    P.dead = false; P.x = 180; P.y = floorY(0) - 40; P.vy = 0; P.onGround = true; P.jumps = 0;
    S.collapseOn = false;
    IN.jump = true; IN.jumpHeld = true; update(1 / 60); IN.jump = false;
    let apex = 0; for (let i = 0; i < 60; i++) { update(1 / 60); apex = Math.min(apex, P.vy); }
    out.singleJumpApexPx = Math.round(apex === 0 ? 0 : (CFG.jumpV * CFG.jumpV) / (2 * CFG.G));
    out.doubleJumpApexPx = Math.round((CFG.jumpV * CFG.jumpV) / (2 * CFG.G) + (CFG.djV * CFG.djV) / (2 * CFG.G));
    out.warnSeconds = +(CFG.warnAhead / CFG.collapseSpeed).toFixed(2);
    out.collapseFloorsPerMin = +(CFG.collapseSpeed / CFG.FH * 60).toFixed(1);
    out.wallSlideFall = CFG.wallSlideMax; out.climbUp = CFG.climbV;
    out.meleeTKO_wisp = Math.ceil(20 / CFG.melee.dmg); out.meleeTKO_crawl = Math.ceil(30 / CFG.melee.dmg);
    out.hitsToDie = Math.ceil(CFG.hpMax / 15);
    return out;
  },
};
