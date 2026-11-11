// --- CONFIGURATION & ENDPOINTS ---
const SPREADSHEET_ID = "1lWB14GzVzE_14WMTsG_Rj71gXYowpDeyovovxau7iDg";
const BOOKS_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&sheet=Books`;
const PAGES_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&sheet=Pages`;

// In-memory data store
let libraryBooks = [];
let libraryPages = [];
let activeTagFilter = null;
let activeCategoryFilter = "ALL";

// --- INITIALIZATION ---
document.addEventListener("DOMContentLoaded", () => {
  initSearchAndFilters();
  initCategoryTabs();
  fetchCatalog();
});

// --- FETCH & PARSE DATA ---
async function fetchCatalog() {
  const shelfCount = document.getElementById("shelfCount");
  if (shelfCount) shelfCount.innerText = "Connecting to database...";

  try {
    const [booksRes, pagesRes] = await Promise.all([
      fetch(BOOKS_URL),
      fetch(PAGES_URL)
    ]);

    const booksText = await booksRes.text();
    const pagesText = await pagesRes.text();

    libraryBooks = parseGvizResponse(booksText);
    libraryPages = parseGvizResponse(pagesText);

    // Update ribbon metrics
    const statElem = document.getElementById("statPlaybooks");
    if (statElem) statElem.innerText = `${libraryBooks.length} Catalogued`;

    renderBookshelf(libraryBooks);
  } catch (error) {
    console.error("Fetch error:", error);
    if (shelfCount) shelfCount.innerText = "Error loading catalog";
    const grid = document.getElementById("bookGrid");
    if (grid) {
      grid.innerHTML = `
        <div class="col-span-full p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          Failed to load database. Please verify spreadsheet sharing permissions.
        </div>`;
    }
  }
}

function parseGvizResponse(rawText) {
  const jsonString = rawText.substring(rawText.indexOf("{"), rawText.lastIndexOf("}") + 1);
  const data = JSON.parse(jsonString);
  const cols = data.table.cols.map(c => (c.label || c.id || "").trim().toLowerCase());
  
  return data.table.rows.map(row => {
    let item = {};
    row.c.forEach((cell, i) => {
      const colName = cols[i] || `col_${i}`;
      item[colName] = cell ? (cell.f || cell.v || "") : "";
    });
    return item;
  });
}

// --- SEARCH & CATEGORY CONTROLLERS ---
function initSearchAndFilters() {
  const searchInput = document.getElementById("globalSearchInput");
  if (searchInput) {
    searchInput.addEventListener("input", () => applyFilters());
  }

  document.querySelectorAll(".tag-filter-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const selectedTag = e.target.getAttribute("data-tag") || e.target.innerText.replace("#", "").trim();
      
      if (activeTagFilter === selectedTag) {
        activeTagFilter = null;
        e.target.classList.remove("ring-2", "ring-white", "bg-white/30");
      } else {
        document.querySelectorAll(".tag-filter-btn").forEach(b => b.classList.remove("ring-2", "ring-white", "bg-white/30"));
        activeTagFilter = selectedTag;
        e.target.classList.add("ring-2", "ring-white", "bg-white/30");
      }

      applyFilters();
    });
  });
}

function initCategoryTabs() {
  document.querySelectorAll(".cat-pill").forEach(btn => {
    btn.addEventListener("click", (e) => {
      document.querySelectorAll(".cat-pill").forEach(b => {
        b.classList.remove("bg-polaris-primary-container", "text-white", "font-semibold");
        b.classList.add("hover:text-polaris-text-heading");
      });

      e.target.classList.add("bg-polaris-primary-container", "text-white", "font-semibold");
      e.target.classList.remove("hover:text-polaris-text-heading");
      activeCategoryFilter = e.target.getAttribute("data-category");
      applyFilters();
    });
  });
}

function applyFilters() {
  const searchInput = document.getElementById("globalSearchInput");
  const query = (searchInput ? searchInput.value : "").trim().toLowerCase();

  const filtered = libraryBooks.filter(book => {
    const currentBookId = String(book.book_id || "").trim();
    const relatedPages = libraryPages.filter(p => String(p.book_id || "").trim() === currentBookId);

    // 1. Category Filter Match
    if (activeCategoryFilter !== "ALL") {
      const bCat = (book.category || "").toLowerCase();
      if (!bCat.includes(activeCategoryFilter.toLowerCase())) return false;
    }

    // 2. Tag Filter Match
    if (activeTagFilter) {
      const matchesTag = relatedPages.some(p => {
        const pageTags = (p.tags || "").toLowerCase().split(",").map(t => t.trim());
        return pageTags.includes(activeTagFilter.toLowerCase());
      });
      if (!matchesTag) return false;
    }

    // 3. Search Query Match
    if (!query) return true;

    const bookMatches = 
      (book.title || "").toLowerCase().includes(query) ||
      (book.description || "").toLowerCase().includes(query) ||
      (book.category || "").toLowerCase().includes(query) ||
      currentBookId.toLowerCase().includes(query);

    const pagesMatch = relatedPages.some(p => 
      (p.title || "").toLowerCase().includes(query) ||
      (p.body_markdown || "").toLowerCase().includes(query) ||
      (p.tags || "").toLowerCase().includes(query)
    );

    return bookMatches || pagesMatch;
  });

  renderBookshelf(filtered);
}

// --- READING PROGRESS (USER-INITIATED ONLY) ---
function getReadingProgress() {
  try {
    const saved = localStorage.getItem('polaris_reading_progress');
    return saved ? JSON.parse(saved) : {};
  } catch (e) {
    return {};
  }
}

// Explicit Toggle: Only changes state when user clicks the checkbox
function togglePageCompletion(pageId, bookId, isChecked) {
  if (!pageId) return;
  const cleanPageId = String(pageId).trim();
  const pageObj = libraryPages.find(p => String(p.page_id).trim() === cleanPageId);
  const targetBookId = String(bookId || (pageObj ? pageObj.book_id : "")).trim();

  if (!targetBookId) return;

  const progress = getReadingProgress();
  if (!progress[targetBookId]) {
    progress[targetBookId] = [];
  }

  if (isChecked) {
    if (!progress[targetBookId].includes(cleanPageId)) {
      progress[targetBookId].push(cleanPageId);
    }
  } else {
    progress[targetBookId] = progress[targetBookId].filter(id => id !== cleanPageId);
  }

  localStorage.setItem('polaris_reading_progress', JSON.stringify(progress));

  // Refresh active reader metrics in place
  updateReaderProgressWidgets(targetBookId);
}

function calculateBookProgress(bookId, totalPages) {
  const cleanBookId = String(bookId || "").trim();
  const progress = getReadingProgress();
  const readList = progress[cleanBookId] || [];
  const count = Math.min(readList.length, totalPages);
  const percentage = totalPages > 0 ? Math.round((count / totalPages) * 100) : 0;
  
  return {
    readPages: count,
    percentage: percentage,
    isCompleted: totalPages > 0 && count >= totalPages
  };
}

// Dynamically updates reader sidebar metrics without redrawing the whole page
function updateReaderProgressWidgets(bookId) {
  const pagesInBook = libraryPages.filter(p => String(p.book_id || "").trim() === bookId);
  const stats = calculateBookProgress(bookId, pagesInBook.length);

  const sidebarCount = document.getElementById("sidebarProgressCount");
  const sidebarBar = document.getElementById("sidebarProgressBar");
  const sidebarStatus = document.getElementById("sidebarProgressStatus");

  if (sidebarCount) sidebarCount.innerText = `${stats.readPages} / ${pagesInBook.length} Completed`;
  if (sidebarBar) sidebarBar.style.width = `${stats.percentage}%`;
  if (sidebarStatus) {
    sidebarStatus.innerText = stats.isCompleted 
      ? "✓ Completed (100%)" 
      : `${stats.percentage}% Completed`;
  }
}

// --- BOOKSHELF RENDERER ---
function renderBookshelf(books) {
  const grid = document.getElementById("bookGrid");
  const shelfCount = document.getElementById("shelfCount");
  const shelfControls = document.getElementById("shelfControls");
  const ingestCallout = document.getElementById("ingestCallout");
  const statRibbon = document.getElementById("statRibbon");
  const heroSection = document.querySelector(".hero-section");

  // Restore homepage containers
  if (shelfControls) shelfControls.classList.remove("hidden");
  if (ingestCallout) ingestCallout.classList.remove("hidden");
  if (statRibbon) statRibbon.classList.remove("hidden");
  if (heroSection) heroSection.classList.remove("hidden");

  if (shelfCount) {
    shelfCount.innerText = `${books.length} Playbook${books.length === 1 ? '' : 's'} Available`;
  }

  if (!grid) return;

  if (books.length === 0) {
    grid.innerHTML = `
      <div class="col-span-full py-16 text-center text-polaris-text-muted bg-white rounded-2xl border border-polaris-border-subtle shadow-elevation-1">
        <span class="text-3xl">🔍</span>
        <p class="font-display text-base font-semibold text-polaris-text-heading mt-2">No matching playbooks found</p>
        <p class="text-xs text-polaris-text-muted mt-1 font-normal">Try adjusting your query, switching categories, or clearing tags.</p>
      </div>`;
    return;
  }

  grid.innerHTML = books.map(book => {
    const currentBookId = String(book.book_id || "").trim();
    const bookPages = libraryPages.filter(p => String(p.book_id || "").trim() === currentBookId);
    const pageCount = bookPages.length;
    const firstPageId = pageCount > 0 ? String(bookPages[0].page_id).trim() : null;

    // Accurate calculation based solely on user-checked pages
    const stats = calculateBookProgress(currentBookId, pageCount);

    const allTags = [...new Set(bookPages.flatMap(p => (p.tags || "").split(",").map(t => t.trim()).filter(Boolean)))];
    const tagPills = allTags.slice(0, 3).map(t => `<span class="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-mono border border-slate-200">#${t}</span>`).join(" ");

    const actionClick = firstPageId 
      ? `viewPage('${firstPageId}', '${currentBookId}')` 
      : `alert('No pages published for this playbook yet.')`;

    // High-contrast, balanced progress bar
    const progressBlock = stats.isCompleted 
      ? `
        <div class="mt-4 pt-3 border-t border-polaris-border-subtle flex items-center justify-between">
          <span class="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-200">
            ✓ Complete
          </span>
          <span class="text-xs font-mono font-bold text-emerald-700">${pageCount} of ${pageCount} Pages (100%)</span>
        </div>
      `
      : `
        <div class="mt-4 pt-3 border-t border-polaris-border-subtle">
          <div class="flex justify-between text-xs text-polaris-text-muted mb-1.5 font-medium">
            <span>Reading Progress</span>
            <span class="font-mono text-polaris-text-heading font-semibold">${stats.readPages} of ${pageCount} Pages (${stats.percentage}%)</span>
          </div>
          <div class="w-full bg-polaris-progress-track rounded-full h-2 overflow-hidden border border-slate-200">
            <div class="bg-polaris-primary-container h-2 rounded-full transition-all duration-500" style="width: ${stats.percentage}%"></div>
          </div>
        </div>
      `;

    return `
      <div class="bg-polaris-card-bg border border-polaris-border-subtle rounded-xl p-6 hover:-translate-y-0.5 hover:shadow-elevation-2 transition-all duration-200 flex flex-col justify-between group">
        <div>
          <div class="flex items-center justify-between mb-3">
            <span class="text-[10px] font-bold tracking-wider uppercase px-2 py-0.5 rounded-sm bg-polaris-primary-light text-polaris-primary-container border border-indigo-100 font-sans">
              ${book.category || "General"}
            </span>
            <span class="text-xs font-mono text-polaris-text-muted font-medium">${currentBookId}</span>
          </div>

          <h3 onclick="${actionClick}" class="font-display font-semibold text-polaris-text-heading text-lg leading-snug mb-2 group-hover:text-polaris-primary-container cursor-pointer transition">
            ${book.title || "Untitled Book"}
          </h3>
          <p class="text-xs text-polaris-text-body line-clamp-2 leading-relaxed mb-4">${book.description || "No description provided."}</p>
          <div class="flex flex-wrap gap-1.5 mb-2">${tagPills}</div>
        </div>

        <div>
          ${progressBlock}
          <div class="flex items-center justify-between pt-4 mt-2 text-xs text-polaris-text-muted">
            <span class="flex items-center gap-1.5"><span class="w-1.5 h-1.5 rounded-full bg-slate-400"></span> POC: ${book.owner_poc || "Unassigned"}</span>
            <button type="button" onclick="${actionClick}" class="font-semibold text-polaris-primary-container hover:text-indigo-800 inline-flex items-center gap-1 cursor-pointer">
              ${pageCount} ${pageCount === 1 ? "Page" : "Pages"} &rarr;
            </button>
          </div>
        </div>
      </div>
    `;
  }).join("");
}

// --- DEDICATED REDESIGNED PAGE READER VIEW ---
function viewPage(pageId, bookId) {
  const cleanPageId = String(pageId || "").trim();
  const page = libraryPages.find(p => String(p.page_id || "").trim() === cleanPageId);
  const activeBookId = String(bookId || (page ? page.book_id : "")).trim();
  const currentBook = libraryBooks.find(b => String(b.book_id).trim() === activeBookId);

  // NOTE: We DO NOT automatically mark as read here anymore!
  // Completion is purely driven by user checkbox toggle.

  const pagesInBook = libraryPages.filter(p => String(p.book_id || "").trim() === activeBookId);
  const container = document.getElementById("bookGrid");
  const shelfControls = document.getElementById("shelfControls");
  const ingestCallout = document.getElementById("ingestCallout");
  const statRibbon = document.getElementById("statRibbon");
  const heroSection = document.querySelector(".hero-section");

  if (!page || !container) return;

  // Clean reader mode: hide bookshelf search and ribbons
  if (shelfControls) shelfControls.classList.add("hidden");
  if (ingestCallout) ingestCallout.classList.add("hidden");
  if (statRibbon) statRibbon.classList.add("hidden");
  if (heroSection) heroSection.classList.add("hidden");

  // Chapter tab switcher
  const pageTabs = pagesInBook.map(p => {
    const isCurrent = String(p.page_id || "").trim() === cleanPageId;
    const activeClass = isCurrent 
      ? "bg-polaris-primary-container text-white font-semibold shadow-sm" 
      : "bg-slate-100 text-polaris-text-body hover:bg-slate-200 font-medium";
    return `
      <button onclick="viewPage('${String(p.page_id).trim()}', '${activeBookId}')" 
              class="px-3 py-1.5 rounded-lg text-xs transition cursor-pointer font-sans ${activeClass}">
        Page ${p.page_number || ''}: ${p.title}
      </button>
    `;
  }).join("");

  const stats = calculateBookProgress(activeBookId, pagesInBook.length);
  const isPageDone = (getReadingProgress()[activeBookId] || []).includes(cleanPageId);

  // Review status badge calculation
  const today = new Date();
  const reviewDueDate = new Date(page.next_review_due);
  const isStale = today > reviewDueDate || page.status === "PENDING_REVIEW";
  const statusBadge = isStale 
    ? `<span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300">⚠️ PENDING REVIEW (Stale)</span>`
    : `<span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-900 border border-emerald-300">✓ PUBLISHED ${page.version || 'v1.0'}</span>`;

  container.innerHTML = `
    <div class="col-span-full max-w-7xl mx-auto w-full pt-2">
      
      <!-- Reader Header Bar -->
      <div class="bg-polaris-hero-dark text-white rounded-t-2xl px-6 py-4 flex flex-wrap items-center justify-between gap-4 border-b border-slate-800">
        <div class="flex items-center gap-3">
          <button type="button" onclick="exitReaderView()" class="text-xs text-indigo-300 hover:text-white inline-flex items-center gap-1.5 font-medium cursor-pointer transition">
            &larr; Back to Bookshelf
          </button>
          <span class="text-slate-600">|</span>
          <span class="text-xs text-slate-400 font-mono">Playbooks &gt; ${activeBookId}</span>
          <span class="font-display text-xs font-bold text-white bg-white/10 px-2 py-0.5 rounded">${currentBook ? currentBook.title : 'Playbook Active'}</span>
        </div>
        <div class="text-xs font-mono text-slate-400">
          ${page.page_id} (Page ${page.page_number || 1} of ${pagesInBook.length})
        </div>
      </div>

      <!-- Action Utility Bar -->
      <div class="bg-white border-x border-b border-polaris-border-subtle px-6 py-3 flex flex-wrap items-center justify-between gap-3 shadow-sm">
        <div class="flex flex-wrap gap-2">
          ${pageTabs}
        </div>
        <div class="flex items-center gap-4 text-xs text-polaris-text-muted">
          <button onclick="navigator.clipboard.writeText(window.location.href); alert('Link copied!');" class="hover:text-polaris-primary-container font-medium cursor-pointer">📋 Copy Link</button>
          <button onclick="window.print()" class="hover:text-polaris-primary-container font-medium cursor-pointer">🖨️ Print / PDF</button>
          <a href="https://docs.google.com/forms" target="_blank" class="hover:text-polaris-primary-container font-medium">✏️ Suggest Edit</a>
        </div>
      </div>

      <!-- Split-Screen Reader Layout -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-8 bg-white border-x border-b border-polaris-border-subtle p-8 rounded-b-2xl shadow-elevation-1">
        
        <!-- Left: Document Content (8 cols) -->
        <article class="lg:col-span-8 space-y-6">
          
          <!-- Governance Header Box -->
          <div class="bg-slate-50 border border-slate-200 rounded-xl p-5 text-xs text-polaris-text-body">
            <div class="flex items-center justify-between pb-3 border-b border-slate-200 mb-3">
              ${statusBadge}
              
              <!-- Manual Completion Checkbox -->
              <label class="inline-flex items-center gap-2 cursor-pointer font-medium text-polaris-text-heading hover:text-polaris-primary-container select-none">
                <input 
                  type="checkbox" 
                  id="completionToggle"
                  ${isPageDone ? 'checked' : ''} 
                  class="w-4 h-4 text-polaris-primary-container rounded cursor-pointer accent-indigo-600 focus:ring-indigo-500" 
                  onchange="togglePageCompletion('${cleanPageId}', '${activeBookId}', this.checked)"
                >
                <span class="font-semibold text-xs">Mark as Completed</span>
              </label>
            </div>
            
            <div class="grid grid-cols-3 gap-4 font-mono text-[11px]">
              <div>
                <span class="block text-slate-500 font-sans uppercase text-[9px] font-bold">Document Owner</span>
                <span class="font-bold text-polaris-text-heading">${page.document_owner || 'SME - Sales Ops'}</span>
              </div>
              <div>
                <span class="block text-slate-500 font-sans uppercase text-[9px] font-bold">Next Audit Cycle</span>
                <span class="font-bold text-polaris-text-heading">${page.next_review_due || 'Q1 2027'}</span>
              </div>
              <div>
                <span class="block text-slate-500 font-sans uppercase text-[9px] font-bold">Approval Authority</span>
                <span class="font-bold text-polaris-text-heading">VP Revenue &amp; RevOps</span>
              </div>
            </div>
          </div>

          <!-- Page Heading -->
          <div>
            <h1 class="font-display text-3xl font-extrabold text-polaris-text-heading tracking-tight mb-2">${page.title || 'Untitled Page'}</h1>
            <p class="text-polaris-text-muted text-sm font-normal">Actionable guidelines and verified talk-tracks for frontline teams.</p>
          </div>

          <!-- Body Content Area -->
          <div class="prose max-w-none text-polaris-text-body text-sm leading-relaxed whitespace-pre-wrap font-sans">
            ${page.body_markdown || 'No content available for this section.'}
          </div>

          <!-- Talk-Track Script Box -->
          <div class="bg-polaris-hero-dark text-slate-100 rounded-xl p-5 space-y-3 shadow-md mt-6 border border-slate-800">
            <div class="flex items-center justify-between">
              <span class="text-xs font-mono text-emerald-400 uppercase tracking-wider font-bold">Talk-Track Script</span>
              <button onclick="navigator.clipboard.writeText('Anchor back to calculated multi-year implementation savings.'); alert('Script copied!');" class="text-xs bg-white/10 hover:bg-white/20 text-white px-3 py-1 rounded transition cursor-pointer font-sans">
                📋 Copy Script
              </button>
            </div>
            <p class="text-xs font-mono text-slate-200 leading-relaxed bg-black/40 p-3.5 rounded-lg border border-white/10">
              "When enterprise procurement leaders and line-of-business sponsors challenge standard SaaS license tiers, immediate pricing discounting forfeits deal leverage. Anchor back to calculated multi-year implementation savings."
            </p>
          </div>

          <!-- Bottom Navigation -->
          <div class="pt-8 border-t border-slate-100 flex items-center justify-between">
            <button type="button" onclick="exitReaderView()" class="text-xs text-polaris-primary-container font-semibold hover:underline cursor-pointer">
              &larr; Back to Catalog
            </button>
            <span class="text-xs text-polaris-text-muted font-mono">End of Page ${page.page_number || 1}</span>
          </div>

        </article>

        <!-- Right: Sticky Sidebar (4 cols) -->
        <aside class="lg:col-span-4 space-y-6">
          
          <!-- In This Page TOC -->
          <div class="bg-slate-50 border border-polaris-border-subtle rounded-xl p-5">
            <div class="flex items-center justify-between mb-3">
              <h4 class="font-display font-bold text-xs uppercase tracking-wider text-polaris-text-heading">In this page</h4>
              <span class="text-[10px] bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded font-mono">3 sections</span>
            </div>
            <ul class="text-xs space-y-2 text-polaris-text-body">
              <li class="hover:text-polaris-primary-container cursor-pointer font-medium">1. Strategic Overview</li>
              <li class="hover:text-polaris-primary-container cursor-pointer font-medium">2. Approved Response Flow</li>
              <li class="hover:text-polaris-primary-container cursor-pointer font-medium">3. Objection Handling Matrix</li>
            </ul>
          </div>

          <!-- Playbook Progress Widget -->
          <div class="bg-slate-50 border border-polaris-border-subtle rounded-xl p-5">
            <h4 class="font-display font-bold text-xs uppercase tracking-wider text-polaris-text-heading mb-2">Playbook Progress</h4>
            <div class="flex justify-between text-xs text-polaris-text-muted mb-1.5">
              <span>Overall Completion</span>
              <span class="font-mono font-bold text-polaris-text-heading" id="sidebarProgressCount">${stats.readPages} / ${pagesInBook.length} Completed</span>
            </div>
            <div class="w-full bg-slate-200 rounded-full h-2 overflow-hidden mb-3 border border-slate-300">
              <div id="sidebarProgressBar" class="bg-polaris-primary-container h-2 rounded-full transition-all duration-500" style="width: ${stats.percentage}%"></div>
            </div>
            <div class="text-[11px] text-polaris-text-muted flex items-center justify-between font-mono">
              <span>Status</span>
              <span id="sidebarProgressStatus" class="font-semibold text-polaris-text-heading">${stats.isCompleted ? '✓ Completed (100%)' : `${stats.percentage}% Completed`}</span>
            </div>
          </div>

          <!-- Associated Collateral -->
          <div class="bg-slate-50 border border-polaris-border-subtle rounded-xl p-5">
            <h4 class="font-display font-bold text-xs uppercase tracking-wider text-polaris-text-heading mb-3">Associated Collateral</h4>
            <div class="space-y-2 text-xs">
              <a href="#" class="block p-2 bg-white rounded border border-polaris-border-subtle text-polaris-text-body hover:border-polaris-primary-container transition font-medium">
                📊 ROI &amp; Total Cost Calculator
              </a>
              <a href="#" class="block p-2 bg-white rounded border border-polaris-border-subtle text-polaris-text-body hover:border-polaris-primary-container transition font-medium">
                🛡️ SOC2 &amp; Compliance Summary Sheet
              </a>
              <a href="#" class="block p-2 bg-white rounded border border-polaris-border-subtle text-polaris-text-body hover:border-polaris-primary-container transition font-medium">
                📑 VP Finance Concession Matrix
              </a>
            </div>
          </div>

          <!-- Questions Widget -->
          <div class="p-4 bg-polaris-primary-light border border-indigo-100 rounded-xl flex items-center gap-3">
            <div class="w-8 h-8 rounded-full bg-polaris-primary-container text-white flex items-center justify-center font-bold text-xs">?</div>
            <div class="text-xs">
              <p class="font-display font-bold text-polaris-text-heading">Questions on the playbook?</p>
              <p class="text-polaris-text-muted">Drop queries on Slack: <span class="font-mono text-polaris-primary-container">#sales-enablement</span></p>
            </div>
          </div>

        </aside>

      </div>
    </div>
  `;
}

// Cleanly returns to bookshelf and restores hero & category controls
function exitReaderView() {
  const heroSection = document.querySelector(".hero-section");
  const statRibbon = document.getElementById("statRibbon");
  if (heroSection) heroSection.classList.remove("hidden");
  if (statRibbon) statRibbon.classList.remove("hidden");

  renderBookshelf(libraryBooks);
}