/**
 * The shelves. A fixed set of topics, each with a cloth (four shades so its books read as a set) and the words
 * that send a book there. ebook-treasure-chest tags every book with one of ~1000 categories and Z-Library has its
 * own; both are folded onto these by keyword. Every book's spine (cloth, style, width, height) comes from its id,
 * so the same book always looks the same.
 */

export type TopicKey =
  | 'literature' | 'mystery' | 'scifi' | 'history' | 'biography' | 'philosophy' | 'society' | 'psychology'
  | 'science' | 'tech' | 'business' | 'money' | 'growth' | 'art' | 'life' | 'unsorted';

export type Topic = {
  key: TopicKey;
  name: string;
  en: string;
  /** Cloth shades: [base, light, deep, pale]. */
  shades: [string, string, string, string];
  blurb: string;
  words: string[];
};

export const TOPICS: Topic[] = [
  { key: 'literature', name: '文学', en: 'Literature', shades: ['#a8432f', '#c4634b', '#7a2c1d', '#e2a493'], blurb: '小说、散文、诗与经典，一页页读下去的那种书。',
    words: ['文学', '小说', '经典', '名著', '散文', '随笔', '诗', '诗歌', '诗词', '杂文', '外国文学', '当代', '现代', '青春', '爱情', '言情', '武侠', '短篇', '故事', '戏剧', '剧本', '童话', '文集', '书信', '日记', '红楼梦', '四大名著', '鲁迅', '老舍', '毛姆', '莎士比亚', '石黑一雄', '文艺', '外国', '日本', '法国', '英国', '美国', '俄罗斯', '拉美', 'fiction', 'literature', 'novel', 'poetry'] },
  { key: 'mystery', name: '推理悬疑', en: 'Mystery', shades: ['#2d3b4f', '#4a5a70', '#1b2532', '#93a1b5'], blurb: '谁做的，怎么做的，为什么。',
    words: ['推理', '悬疑', '侦探', '犯罪', '惊悚', '恐怖', '刑侦', '法医', '谍战', '间谍', '灵异', '罪案', '盗墓', '密室', 'mystery', 'thriller', 'crime', 'detective'] },
  { key: 'scifi', name: '科幻奇幻', en: 'Sci-fi & Fantasy', shades: ['#3c3f8f', '#5b5fb0', '#25285f', '#a5a8db'], blurb: '另一个宇宙、另一种可能。',
    words: ['科幻', '奇幻', '魔幻', '玄幻', '三体', '穿越', '神话', '神怪', 'science fiction', 'sci-fi', 'fantasy'] },
  { key: 'history', name: '历史', en: 'History', shades: ['#8c5a2b', '#aa7745', '#633e1a', '#d9b48a'], blurb: '我们是怎么走到今天的。',
    words: ['历史', '史', '近代', '二战', '一战', '晚清', '民国', '明朝', '清朝', '唐朝', '宋朝', '汉朝', '三国', '春秋', '战国', '秦汉', '隋唐', '魏晋', '南北朝', '北宋', '南宋', '战争', '军事', '罗马', '古希腊', '考古', '文物', '中世纪', '冷战', '抗战', '帝国', '文明', '拜占庭', '十字军', '故宫', '敦煌', '海军', '纳粹', '太平天国', '北洋', '革命', 'history'] },
  { key: 'biography', name: '传记', en: 'Biography', shades: ['#6e5a3e', '#8d7757', '#4d3e29', '#c9b796'], blurb: '一个人的一生，放在一本书里。',
    words: ['传记', '自传', '回忆录', '回忆', '人物', '名家', '乔布斯', '拿破仑', '曾国藩', '巴菲特传', 'biography', 'memoir'] },
  { key: 'philosophy', name: '哲学思想', en: 'Philosophy', shades: ['#5e4b7a', '#7c6a99', '#3f3154', '#b9acd0'], blurb: '那些老问题，至今没有答案。',
    words: ['哲学', '思想', '宗教', '国学', '佛学', '佛教', '道家', '儒家', '儒学', '论语', '心学', '伦理', '美学', '逻辑', '禅修', '修行', '老子', '孔子', '经学', '古籍', '理想国', 'philosophy', 'religion'] },
  { key: 'society', name: '社会人文', en: 'Society', shades: ['#9a3a4e', '#b85a6c', '#6e2635', '#e0a1ae'], blurb: '我们怎样生活在一起。',
    words: ['社会', '文化', '政治', '人文', '人类学', '社会学', '社科', '女性', '纪实', '法律', '法学', '城市', '民俗', '新闻', '传媒', '种族', '民主', '自由', '外交', '人口', '全球', '时政', '中国', '世界', 'society', 'politics', 'law', 'sociology'] },
  { key: 'psychology', name: '心理', en: 'Mind', shades: ['#4c5fa8', '#6c7ec4', '#33427a', '#aab6e6'], blurb: '我们为什么这样想、这样做。',
    words: ['心理', '心理学', '情绪', '认知', '人性', '情商', '思维', '思考', '大脑', '脑科学', '人格', '焦虑', '性格', '行为', '心灵', '疗愈', '治愈', 'psychology'] },
  { key: 'science', name: '科学', en: 'Science', shades: ['#2f6b4f', '#4f8d6d', '#1e4a36', '#97c4ac'], blurb: '世界如何运转，我们又是怎么知道的。',
    words: ['科普', '科学', '物理', '数学', '生物', '宇宙', '天文', '医学', '进化', '基因', '量子', '自然', '动物', '植物', '地理', '化学', '海洋', '病毒', '癌症', '太空', '概率', '统计', '复杂性', 'science', 'physics', 'mathematics', 'biology', 'medicine'] },
  { key: 'tech', name: '技术', en: 'Technology', shades: ['#226a80', '#3f8aa0', '#154a5a', '#8ec3d2'], blurb: '代码、机器和互联网。',
    words: ['计算机', '编程', 'python', 'java', 'linux', 'web', 'css', '前端', '互联网', '人工智能', 'ai', '算法', '大数据', '数据', '数据分析', '区块链', '芯片', '科技', '技术', '爬虫', '5g', '智能', '机器人', '硅谷', '谷歌', '苹果', '华为', '小米', 'computer', 'programming', 'software', 'technology'] },
  { key: 'business', name: '商业管理', en: 'Business', shades: ['#7a5230', '#9a7050', '#563820', '#c9a585'], blurb: '公司、产品和做成一件事的方法。',
    words: ['管理', '商业', '营销', '企业', '职场', '创业', '运营', '品牌', '领导力', '领导', '战略', '销售', '产品', '广告', '文案', '经营', '定位', '团队', '商战', '零售', '电子商务', '新媒体', '德鲁克', '工作', 'business', 'management', 'marketing'] },
  { key: 'money', name: '经济金融', en: 'Money', shades: ['#7d7120', '#9c8f38', '#564e12', '#d1c680'], blurb: '钱从哪里来，又往哪里去。',
    words: ['经济', '金融', '投资', '理财', '股票', '基金', '交易', '货币', '财富', '巴菲特', '华尔街', '期货', '证券', '量化', '财务', '会计', '股市', '期权', '私募', '财报', '可转债', '银行', '保险', '房地产', '股权', '资本', '财经', '新经济', '贸易', '经济学', 'economics', 'finance', 'investing'] },
  { key: 'growth', name: '成长学习', en: 'Growth', shades: ['#2c7a76', '#4c9b94', '#1c5654', '#8cc4bd'], blurb: '学习、沟通，和慢慢变好。',
    words: ['励志', '成长', '学习', '教育', '沟通', '效率', '习惯', '方法', '写作', '阅读', '读书', '演讲', '口才', '育儿', '亲子', '成功', '自我', '说话', '记忆', '时间', '规划', '决策', '社交', '谈判', '英语', '知识', '技能', '鸡汤', '正能量', '激励', 'self-help', 'education'] },
  { key: 'art', name: '艺术设计', en: 'Art & Design', shades: ['#b0447e', '#c9669a', '#82305b', '#e8a9cb'], blurb: '画、电影、音乐与设计。',
    words: ['艺术', '设计', '电影', '音乐', '绘画', '摄影', '建筑', '美术', '漫画', '绘本', '画册', '时尚', '梵高', '博物馆', '游戏', '卡通', 'art', 'design', 'music', 'film'] },
  { key: 'life', name: '生活', en: 'Living', shades: ['#a8801f', '#c79c3a', '#7a5c15', '#e5c97a'], blurb: '吃饭、走路、睡觉，和其余的日子。',
    words: ['生活', '健康', '美食', '旅行', '旅游', '运动', '健身', '饮食', '养生', '游记', '咖啡', '茶', '减肥', '减脂', '跑步', '睡眠', '猫', '户外', '烹饪', '烤箱', '啤酒', '食帖', '保健', '中医', '家庭', '婚姻', '两性', '情感', 'cooking', 'travel', 'health'] },
  { key: 'unsorted', name: '未分类', en: 'Unsorted', shades: ['#5d5a55', '#7b776f', '#3f3d39', '#aaa59b'], blurb: '还没上架的书。打开它，可以挪到合适的那一层。',
    words: [] },
];

export const TOPIC = Object.fromEntries(TOPICS.map((t) => [t.key, t])) as Record<TopicKey, Topic>;
export const isTopic = (v: unknown): v is TopicKey => typeof v === 'string' && v in TOPIC;
const ORDER = Object.fromEntries(TOPICS.map((t, i) => [t.key, i])) as Record<TopicKey, number>;

/** The shelf a book belongs on: its categories first (most specific word wins), then its title. */
export function topicFor(x: { cats?: string[]; categories?: string; title?: string }): TopicKey {
  const tags = [...(x.cats ?? []), ...(x.categories ?? '').split(/[,;\\/|]/)].map((s) => s.trim().toLowerCase()).filter(Boolean);
  const score = new Map<TopicKey, number>();
  const hit = (s: string, weight: number) => {
    for (const t of TOPICS) for (const w of t.words) {
      if (s === w) score.set(t.key, (score.get(t.key) ?? 0) + weight * 3);
      else if (w.length >= 2 && s.includes(w)) score.set(t.key, (score.get(t.key) ?? 0) + weight);
    }
  };
  tags.forEach((s, i) => hit(s, i === 0 ? 3 : 2));
  if (!score.size && x.title) hit(x.title.toLowerCase(), 1);
  let best: TopicKey = 'unsorted', n = 0;
  for (const [k, v] of score) if (v > n) { best = k; n = v; }
  return best;
}

/* ---------- looks ---------- */

/** FNV-1a, then a small PRNG: the same id always gives the same book. */
export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function rng(seed: number) {
  let a = seed || 1;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type SpineStyle = 'bands' | 'label' | 'sans' | 'foil';
export type Look = { color: string; fg: string; light: boolean; style: SpineStyle; w: number; h: number; hue: number };
const STYLES: SpineStyle[] = ['bands', 'label', 'sans', 'foil'];

export function luminance(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function hueOf(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d < 0.08) return 400 + luminance(hex) * 100;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360 + 20) % 360;
}

/** How thick a book is, in characters: counted once it has been opened, guessed from its file before that. */
export function lengthOf(b: { words?: number; file?: { ext: string; size: number } }): number {
  if (b.words) return b.words;
  if (!b.file) return 0;
  const k = b.file.ext === 'epub' ? 1.7 : b.file.ext === 'txt' ? 2.4 : b.file.ext === 'pdf' ? 18 : 3;
  return Math.min(1.2e6, b.file.size / k);
}

const looks = new Map<string, Look>();
export function lookOf(b: { id: string; topic: TopicKey; chars: number }): Look {
  const key = `${b.id}:${b.topic}:${Math.round(b.chars / 5000)}`;
  const hit = looks.get(key);
  if (hit) return hit;
  const r = rng(hash(b.id));
  const shades = TOPIC[b.topic].shades;
  const pick = r();
  const color = shades[pick < 0.38 ? 0 : pick < 0.7 ? 2 : pick < 0.88 ? 1 : 3];
  const light = luminance(color) > 0.3;
  const style = STYLES[Math.floor(r() * STYLES.length)];
  const wr = r();
  const w = b.chars > 0 ? 28 + 10 * Math.log2(1 + b.chars / 20000) : 34 + wr * 22;
  const look: Look = { color, fg: light ? '#2a2520' : '#f6efe2', light, style, w: Math.round(Math.min(78, Math.max(30, w))), h: Math.round(206 + r() * 52), hue: hueOf(color) };
  looks.set(key, look);
  return look;
}

/* ---------- sorting the shelf ---------- */

export type Sort = 'topic' | 'recent' | 'color' | 'length';
export const SORTS: { key: Sort; label: string }[] = [
  { key: 'topic', label: '分类' },
  { key: 'recent', label: '最近' },
  { key: 'color', label: '颜色' },
  { key: 'length', label: '厚薄' },
];

export type ShelfBook = {
  id: string; title: string; author: string; year?: number; topic: TopicKey; chars: number;
  added: number; opened?: number; pct: number; favorite: boolean; wish: boolean; ext?: string; cover?: string;
};

export function sortBooks(books: ShelfBook[], sort: Sort): ShelfBook[] {
  const by = [...books];
  if (sort === 'topic') by.sort((a, b) => ORDER[a.topic] - ORDER[b.topic] || a.added - b.added);
  if (sort === 'recent') by.sort((a, b) => Math.max(b.added, b.opened ?? 0) - Math.max(a.added, a.opened ?? 0));
  if (sort === 'color') by.sort((a, b) => lookOf(a).hue - lookOf(b).hue || lookOf(a).h - lookOf(b).h);
  if (sort === 'length') by.sort((a, b) => (a.chars || 1e9) - (b.chars || 1e9));
  return by;
}

/** The label on the plank under each run of books: a topic, a month or a thickness. */
export function groupOf(b: ShelfBook, sort: Sort): { key: string; label: string; color?: string } | null {
  if (sort === 'topic') return { key: b.topic, label: TOPIC[b.topic].name, color: TOPIC[b.topic].shades[0] };
  if (sort === 'recent') {
    const d = new Date(Math.max(b.added, b.opened ?? 0));
    const label = `${d.getFullYear()} 年 ${d.getMonth() + 1} 月`;
    return { key: label, label };
  }
  if (sort === 'length') {
    if (!b.chars) return { key: 'unknown', label: '还不知道多厚' };
    if (b.chars < 80_000) return { key: 'thin', label: '薄薄一册' };
    if (b.chars < 250_000) return { key: 'mid', label: '一个周末' };
    return { key: 'thick', label: '大部头' };
  }
  return null;
}

export const fmtChars = (n: number) => (!n ? '' : n >= 10_000 ? `${(n / 10_000).toFixed(n >= 100_000 ? 0 : 1)} 万字` : `${Math.round(n / 100) * 100} 字`);
