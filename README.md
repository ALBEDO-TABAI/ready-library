# Ready Library

一个放在自己电脑上的书架：Ready 的玻璃界面，Gloss 式的书脊、取书动画和页边批注，像纸一样翻的书页；找书时一次搜两个地方：电子书宝库的两万多条书目（点一下就在后台取回），和你自己登录的 Z-Library。

## 跑起来

需要 Node 20.19+ 或 22.12+，推荐 Node 22 LTS。

### Windows

适用于 Windows 10 / 11。安装 [Node.js](https://nodejs.org/) 后，双击项目里的 `start-windows.cmd`：它会安装依赖、构建页面、启动本地服务并打开默认浏览器。使用期间保留启动窗口，按 `Ctrl+C` 停止。第一次准备需要联网；日常也可以直接运行 `npm start` 使用已经构建好的版本。

中文、空格及 `&` 路径可用。文件和阅读记录默认保存在项目的 `data/` 中，更新代码不会删除它们。想换目录或端口，在 PowerShell 中运行：

```powershell
$env:READY_LIBRARY_DATA = 'D:\我的书库'
$env:PORT = '5190'
npm start
```

Z-Library 是可选书源，不影响本地导入和阅读。在 PowerShell 中安装并登录：

```powershell
winget install --id heartleo.zlib --exact
zlib doctor
zlib login --domain https://可用的镜像域名
```

安装后若终端找不到命令，重新打开终端；应用会额外检查 WinGet 的用户程序位置。手动安装的程序可以这样指定（指向 `.exe`，不要把引号包含在路径值内）：

```powershell
$env:ZLIB_BIN = 'C:\Tools\zlib\zlib.exe'
npm start
```

RAR / 7z 优先使用 Windows 自带的 `tar.exe`，也支持已安装的 [7-Zip](https://www.7-zip.org/)。无法解压时会提示补装工具或手动下载。MOBI / AZW3 需要在 Windows 设置中关联支持该格式的阅读器；应用内的「在文件夹中显示」会选中原文件。

批注用 `Ctrl+Enter` 保存；`Esc` 退出输入。其他阅读快捷键和原版相同。

### Windows 独立应用（EXE）

0.2.0 的桌面应用也支持 Windows 10 / 11 x64。安装后不需要 Node.js，也不用保留命令窗口。
从源码制作安装包需要 Node 22.12+，在项目根目录依次运行：

```powershell
npm ci
cd desktop
npm ci
npm run win
```

安装包在 `desktop/dist/Ready-Library-<版本>-win-x64.exe`。也可直接打开
`desktop/dist/win-unpacked/Ready Library.exe`，但移动时必须保留整个 `win-unpacked` 文件夹。
开发时在 `desktop/` 运行 `npm start`；运行 `npm test` 检查独立应用的导入、阅读和重启保存。

独立应用默认把书库放在 `%APPDATA%/Ready Library/library/`，可在「文件 → 打开书库文件夹」中找到。
浏览器版仍使用项目的 `data/`，不会自动搬动原藏书。要继续使用原书库，可以在两个版本均已关闭时，
把 `data/` 中的内容复制到独立应用的书库文件夹；也可在启动前设置 `READY_LIBRARY_DATA` 指向原文件夹。
不要同时运行两个版本来编辑同一个书库。安装包未做开发者数字签名，Windows 可能提示发布者未知。

### 开发或手动启动

```bash
npm install
npm run dev          # 开发：http://127.0.0.1:5190（页面和本地接口在同一个端口）
```

```bash
npm run build
npm start            # 打包后：同样是 http://127.0.0.1:5190，只监听本机
```

书架、书的文件和封面都放在项目里的 `data/`，整个文件夹拷走就是整座书架。想放到别处，启动前设 `READY_LIBRARY_DATA=/路径`。

下载、解压和导入都在 `data/cache/work/` 里进行，一个任务一个文件夹。书上架时文件从那里**移进**书库；之后不管任务是上架、失败、取消还是中途断开，那个文件夹都整个删掉，压缩包里用不上的格式、下载一半的文件都不会留下。每次启动时会清掉上次没跑完的任务文件夹（例如下载中途退出了应用），以及一个月没用过的搜索结果封面缩略图。

### Mac 应用（DMG）

```bash
cd desktop
npm install
npm run dmg          # → desktop/dist/Ready-Library-<版本>-mac-arm64.dmg（Apple 芯片，macOS 12 以上）
```

做法和 Ready Poster Printer 的桌面版一样：Electron 包着打包好的网页，本地接口在应用内部回答（`rl://app/`，不开网络端口），没有 Apple 开发者签名，用的是 ad-hoc 签名。应用的书库放在 `~/Library/Application Support/Ready Library/library/`，和项目里的 `data/` 结构一样，拷过去就是同一座书架。

第一次打开时 macOS 会提示「无法验证开发者」：点「完成」，到**系统设置 → 隐私与安全性**往下找到这条提示，点**「仍要打开」**。之后和普通应用一样双击打开。

`desktop/build/` 里的图标和 DMG 背景用 `npm run icons` 重新生成（用的是 desktop 自带的 Electron 渲染，不需要别的浏览器）。

## 找书

按 `F` 或底部的「找书」。一个搜索框，两个来源并排：

**电子书宝库**（[jbiaojerry/ebook-treasure-chest](https://github.com/jbiaojerry/ebook-treasure-chest)）
第一次用时下载约 7 MB 的书目索引（依次试 GitHub Pages、jsDelivr、raw.githubusercontent），缓存在 `data/cache/`，之后都在本地搜，边打字边出结果；也可以按分类浏览。

这里的书都在城通网盘上。点「取回」，剩下的在后台完成：

1. 书先以「待取回」的样子放上书架；
2. 照网盘分享页自己的步骤走一遍：读文件信息，等网盘要求的计时，要下载地址（和分享页一样，下载开始和结束时各向网盘报一次实际下载的字节数）；
3. 网盘要验证码时，把图片交给你：在书旁边或右下角的任务条里输入，不会自动识别；
4. 压缩包只读末尾的目录，再按字节范围只下载里面的 EPUB（约整个包的三分之一），解压、校验；
5. 文件接到这本书上，封面、作者、标签一起读出来。整套多册的书，每册各上架一本。

访客下载被网盘限速（约 30 KB/s），一本 7 MB 的 EPUB 大约要四分钟；访客一次只能下一个文件，所以多本书会排队。不是 zip 的压缩包（RAR、7z）会整个下载，再用系统自带的 `bsdtar` 解开。取不回来时，书上会写原因，还可以点「去网盘手动下载」，下好的文件拖进窗口一样能接上。

**Z-Library**（通过 [heartleo/zlib](https://github.com/heartleo/zlib) 命令行）
Ready Library 不碰账号密码，只调用你本机的 `zlib`：

```bash
brew install heartleo/tap/zlib     # Windows：winget install --id heartleo.zlib --exact
zlib doctor                        # 找一个能连上的镜像
zlib login --domain https://<上一步的域名>
```

登录后，搜索结果带封面、年份、格式和大小，「下载上架」会在后台跑 `zlib download --json`，下完自动放上书架（封面一起存到本地）。默认只搜 EPUB，可以切到任意格式或 PDF。`zlib` 不在 PATH 里时，用 `ZLIB_BIN=/路径/zlib npm run dev` 指过去。

**本地文件**：EPUB、TXT、PDF、MOBI、AZW3 直接拖进窗口，或点右上角的上传按钮。EPUB 会读出书名、作者、封面和主题标签，TXT 自动识别 UTF-8 和 GB18030 编码。

## 书架

- 打开时先是载入页，和 Ready Poster Printer 的载入页一个样式：名字、一句话、四个数字（宝库书目、分类、划线笔、你书架上的书），载入条是中间那条线。书架在它下面先摆好，载入页淡出时书才落下来。
- **书架**：按分类、最近、颜色、厚薄排，换排法时每本书滑到新位置。书脊的颜色、样式和高矮由书的 id 决定，同一本书永远长一个样；宽度跟着字数走。
- **分类**：15 个分类，宝库的 1000 来个标签和 Z-Library 的分类都按关键词归进去；打开书可以手动挪到别的分类。
- 点书脊，书从架上抽出来：拉出、转身、飞到面前，是同一条先加速后减速的路径；刚离开书架时视角是平的，所以它和架上的书脊一模一样，越拉近立体感越足。书停在你手里，封面朝着你，跟着鼠标微微转动，可以慢慢看封面；点一下封面（或按回车）才翻开：封面向左打开，书同时滑到正中。左边是藏书票，右边是书的信息和「开始阅读」。`Esc` 随时放回去。
- 点「开始阅读」，手里这本书长到阅读器书页的位置和大小，按钮淡去只剩纸；阅读器在下面排好版、画好书页后，两者原地交叉淡入。书在你看着它的时候就已经在后台读好了。
- `R` 随手抽一本还没读完的；`/` 在书架上搜；`←` `→` 沿着书架走。

## 读书

- EPUB 和 TXT 会先排成真正的页（594 × 846 的版心，段落在行尾断开，标题不落在页底，图片按页面缩放），再放进一本可以翻的书里。
- 翻页用的是 [paper-flipbook](https://github.com/JohnnyWang8802/paper-flipbook) 的 WebGL2 纸张模型：拖动页角、点左右两半、`←` `→` / 空格 / PageUp PageDown，鼠标靠近页角时纸会翘起来；没有 WebGL2 时换成 CSS 分条翻页；系统开了「减少动态效果」时直接换页。
- 目录（`T`）、书签（`B`）、笔记（`N`）、排版（字号、行距、宋体/黑体/楷体、白纸/米黄/夜间、双页/单页）。读到哪一页随时存，下次从那里接着读；换字号后位置不变。
- **划线和批注**：在正文上拖选文字（可以跨左右两页），选黄、绿、蓝、粉四种荧光笔或红笔下划线；「批注」在页边写字。有批注的划线，批注会出现在书页旁边的桌面上，和那一行对齐，有一根细线连回去；点它可以改。点书页上的划线可以换颜色、复制、擦掉。划线记的是「第几章第几个字」，所以换字号、字体、单双页后，它们还在原来那几个字上。「笔记」面板按章列出全部划线，可以跳过去，也可以一键复制成 Markdown。
- 正文上单击仍然是翻页；拖选才是划线。
- 在封面页（第 1 页）按 `↑` `↓`，按书架上的顺序换到前一本、后一本，新的一本也停在封面；`↵` 跳到这本书上次读到的地方。只是翻看封面，不会改动「接着读」和阅读进度。
- PDF 用内置阅读器显示，支持翻页、缩放、文字查找和位置保存；也可以交给系统阅读器。MOBI / AZW3 可以一键用系统默认阅读器打开。
- 排版速度：《吶喊》约 0.1 秒，《紅樓夢》（1600 多页）约 2 秒。

## 文件

```
server/                 本地接口（Node，无依赖框架）
  api.mjs               /api/*：书架、导入、封面、两个书源
  db.mjs                data/library.json 的读写
  bookmeta.mjs          从 EPUB 读书名、作者、封面
  jobs.mjs              下载任务（两个书源共用），页面轮询进度
  work.mjs              每个任务的临时文件夹：用完即删，启动时清扫
  sources/treasure.mjs  宝库索引：下载、缓存、搜索
  sources/ctfile.mjs    城通网盘：分享页的接口流程、验证码转交、只取压缩包里的 EPUB
  sources/zlib.mjs      zlib 命令行：status / search / download（只用 JSON 模式和退出码）
  index.mjs             npm start：dist/ + 接口
desktop/                Windows / Mac 应用：窗口、菜单、内部接口、EXE / DMG 打包
src/
  library/              书架、书脊与封面、分类页、取书动画
  find/FindSheet.tsx    找书面板
  find/JobView.tsx      下载进度、验证码输入
  reader/book.ts        EPUB / TXT → 章节（DOMPurify 清洗）
  reader/paginate.ts    章节 → 页
  reader/glturn.js      WebGL2 翻页（改自 paper-flipbook）
  reader/flipbook.js    书本、翻页输入、CSS 备用翻页（改自 paper-flipbook）
  reader/marks.ts       划线：锚点（章 + 字数）、画到书页上
  reader/Notes.tsx      划线浮层、页边批注、笔记列表
  reader/preload.ts     打开书之前预先读好文件
  reader/Reader.tsx     阅读界面
  ui/glass/glass.js     液态玻璃（来自 Ready Poster Printer）
```

## 还没做的

- 城通网盘的自动取回：真实接口验证到「拿到下载地址、读出压缩包目录」为止；完整的下载、解压、上架是用一个照真实接口返回格式写的替身服务跑通的。网盘改接口时这条路会断，那时用「去网盘手动下载」。
- 排好的页没有缓存，大部头每次打开要等一两秒（从书架打开时，这段时间书停在手里等着）。
- 目录的质量取决于书本身；目录太单薄时，会从正文里找「第 X 回 / 第 X 章」重建。
- MOBI / AZW3 不在应用里排版。
- 触屏上还不能拖选划线（拖动是翻页）。

## 来源与许可

- 界面的玻璃材质、配色和字号体系、UI 字体来自 Ready Poster Printer（AGPL-3.0）。
- 书架、书脊、取书动画、页面框架和页边批注的排布参考了 [Gloss](https://github.com/Nutlope/gloss) 的设计，代码是重写的（Gloss 仓库没有声明许可证，没有复制它的代码和图片）。
- `src/reader/glturn.js`、`src/reader/flipbook.js` 改自 paper-flipbook（MIT，见 `licenses/paper-flipbook-LICENSE.txt`）。
- PDF 显示使用 Mozilla PDF.js（Apache-2.0，见 `licenses/pdfjs-LICENSE.txt`）；字体与解码文件随本地构建提供，不需要联网加载。
- 字体：Inter、Inter Tight、Geist Mono、Instrument Serif、Noto Sans SC、Noto Serif SC（SIL OFL）；图标：Lucide（ISC）；玻璃折射贴图：Glass-HQ/liquid-glass（MIT）。见 `licenses/`。
- 宝库索引在运行时从原仓库下载，不随项目分发；Z-Library 通过你自己安装的 zlib 命令行访问。

请只下载和阅读你有权使用的书。
