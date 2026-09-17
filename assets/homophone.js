/**
 * 谐音 / 不吉用字检查
 *
 * 三类词典，从严到宽：
 *   BAD_CHARS    单个不吉、不雅、易被起绰号的字 —— 硬过滤
 *   BAD_WORDS    姓名/名连读后成为负面词的拼音 —— 硬过滤
 *   AWKWARD_WORDS 连读成常用词（多为中性）—— 只提示，不硬过滤
 *
 * 词典保守为上：宁可漏判，不可误伤「思、清、安」这类常用美字。
 */

/** 不吉 / 不雅 / 易起绰号的单字 */
export const BAD_CHARS = new Set([
  // 死亡凶丧
  '死', '亡', '丧', '殇', '殁', '殒', '殡', '殓', '棺', '坟', '墓', '冢', '尸', '骸',
  '凶', '煞', '孽', '灾', '祸', '厄', '殃', '劫', '刑', '囚', '狱', '弑', '戮', '屠',
  // 疾病残弱
  '病', '癌', '瘟', '疫', '疠', '疮', '疡', '痔', '瘘', '瘤', '瘫', '痪', '疯', '癫',
  '聋', '哑', '瞎', '残', '废', '疲', '弱', '夭',
  // 贫贱丑恶
  '贫', '穷', '贱', '恶', '毒', '秽', '淫', '娼', '妓', '奴', '婢', '丐', '盗', '贼',
  '骗', '蠢', '笨', '傻', '呆', '愚', '陋', '丑', '鄙', '吝', '啬', '馋', '懒', '惰',
  // 鬼怪牲畜
  '鬼', '妖', '魔', '魅', '魑', '魍', '狗', '猪', '驴', '彘', '豚', '蛇', '蝎', '蛆',
  // 污秽
  '屁', '尿', '屎', '粪', '溺', '唾', '痰', '脓', '腥', '臊', '臭',
  // 悲苦
  '哭', '泣', '悲', '愁', '惨', '凄', '哀', '怨', '恨', '嗔', '骂', '咒', '诅',
  // 其他负面
  '债', '亏', '败', '衰', '颓', '腐', '朽', '霉', '邪', '奸', '佞', '谄', '谤', '讹',
  '诡', '诈', '贪', '瘾', '赌', '鸩', '蛭', '虱', '蚤', '痴',
]);

/** 姓名或名连读后成为负面词（无声调拼音连写） */
export const BAD_WORDS = new Set([
  'bendan', 'shazi', 'fengzi', 'chizi', 'daomei', 'meiyun', 'zainan', 'shibai',
  'bingtong', 'wangling', 'sixing', 'sixin', 'liumang', 'wuchi', 'wuneng', 'wuyong',
  'wuqing', 'wuliao', 'wuzhi', 'wugui', 'wangba', 'goudan', 'quede', 'pianzi',
  'xiaotou', 'beican', 'tongku', 'xinsui', 'duanming', 'guixie', 'yaomo', 'choushi',
  'aizheng', 'feiyan', 'bingdu', 'shangcan', 'canji', 'shimian', 'shiluo', 'shibai',
  'wangkong', 'kongju', 'yumen', 'youyu', 'jiaolv', 'tongku', 'fanrao', 'pibei',
]);

/** 连读成词（中性或正面，只提示不排除） */
export const AWKWARD_WORDS = new Set([
  'weisheng', 'youbing', 'wanle', 'wandan', 'jiandan', 'shuijiao', 'chifan', 'shangban',
  'xiaban', 'kaiche', 'dianhua', 'shouji', 'xuexiao', 'laoshi', 'tongxue', 'pengyou',
  'gongzuo', 'gongsi', 'laoban', 'qianbao', 'yinhang', 'yisheng', 'hushi', 'jingcha',
  'xiexie', 'zaijian', 'nihao', 'zaoshang', 'wanshang', 'zhongwu', 'jintian', 'mingtian',
  'zuotian', 'shenme', 'zenme', 'keyi', 'buneng', 'meiyou', 'zhidao', 'buzhidao',
  'xihuan', 'taoyan', 'shengqi', 'kaixin', 'nanguo', 'shengri', 'kuaile', 'xingfu',
  'jiankang', 'pingan', 'shunli', 'chenggong', 'zhufu', 'wansui', 'dajia', 'xiaoxin',
  'yonggan', 'congming', 'meili', 'piaoliang', 'shuaiqi', 'wenrou', 'keai', 'tiancai',
  'chuntian', 'xiatian', 'qiutian', 'dongtian', 'yueliang', 'taiyang', 'xingxing',
  'dahai', 'gaoshan', 'liushui', 'baiyun', 'lanqiu', 'zuqiu', 'yinyue', 'dianshi',
]);

/** 姓氏本身容易产生谐音联想时的提醒（仅提示） */
export const SURNAME_HOMOPHONE = {
  吴: '无', 贾: '假', 梅: '霉', 史: '屎', 朱: '猪', 苟: '狗', 秦: '禽', 付: '负',
  裴: '赔', 施: '失', 商: '伤', 桂: '鬼', 屠: '屠', 仇: '仇',
};

/** 去掉声调符号，ü → u，只留字母 */
function plain(p) {
  return String(p || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/gi, '').toLowerCase();
}

/**
 * 检查一个名字
 * @param {string} surname 姓氏（汉字）
 * @param {Array} given 名字的字对象数组（含 p 拼音）
 * @param {string} [surnamePlain] 姓氏的无声调拼音连写，用于检查姓名连读
 * @returns {{bad:boolean, reasons:string[], notes:string[]}}
 */
export function checkName(surname, given, surnamePlain = '') {
  const reasons = [];
  const notes = [];
  const chars = [...surname, ...given.map(g => g.c)];
  for (const ch of chars) {
    if (BAD_CHARS.has(ch)) reasons.push(`含不吉字「${ch}」`);
  }
  const givenPinyin = given.map(c => plain(c.p)).join('');
  const fullPinyin = plain(surnamePlain) + givenPinyin;
  if (BAD_WORDS.has(givenPinyin)) reasons.push(`名连读谐音「${givenPinyin}」`);
  if (fullPinyin && BAD_WORDS.has(fullPinyin)) reasons.push(`姓名连读谐音「${fullPinyin}」`);
  if (AWKWARD_WORDS.has(givenPinyin)) notes.push(`名连读成词「${givenPinyin}」`);
  if (fullPinyin && AWKWARD_WORDS.has(fullPinyin)) notes.push(`姓名连读成词「${fullPinyin}」`);
  const sk = SURNAME_HOMOPHONE[surname];
  if (sk) notes.push(`姓氏「${surname}」谐音「${sk}」`);
  return { bad: reasons.length > 0, reasons, notes };
}

/** 全名拼音（含姓氏读音，用于连读检查与展示） */
export function fullPinyin(surnameReadings, given) {
  return [...surnameReadings, ...given.map(g => g.p || '')].join(' ');
}
