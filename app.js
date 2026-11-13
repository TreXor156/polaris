/**
 * ============================================================================
 * PROJECT POLARIS - FRONT-END APPLICATION ENGINE (app.js)
 * ============================================================================
 * Architecture:
 * - Headless CMS via Google Sheets GViz JSON API
 * - In-Memory Client-Side State & Filtering
 * - Manual Checkbox-Driven Progress Tracking (localStorage)
 * - Dynamic Left-Sidebar Reader Navigation & Markdown Parsing
 * ============================================================================
 */

// ----------------------------------------------------------------------------
// 1. CONFIGURATION & PUBLIC ENDPOINTS
// ----------------------------------------------------------------------------
const SPREADSHEET_ID = "1lWB14GzVzE_14WMTsG_Rj71gXYowpDeyovovxau7iDg";
const BOOKS_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&sheet=Books`;
const PAGES_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&sheet=Pages`;

// ----------------------------------------------------------------------------
// 2. IN-MEMORY STATE STORE
// ----------------------------------------------------------------------------
let libraryBooks = [];
let libraryPages = [];
let activeTagFilter = null;
let activeCategoryFilter = "ALL";

// ----------------------------------------------------------------------------
// 3. APPLICATION INITIALIZATION
// ----------------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  const searchInput = document.getElementById("globalSearchInput");
  if (searchInput) {
    searchInput.addEventListener("input", () => applyFilters());
  }
  fetchCatalog();
});

// ----------------------------------------------------------------------------
// 4. DATA RETRIEVAL & GVIZ PARSER
// ----------------------------------------------------------------------------

/**
 * Fetches Books and Pages data concurrently from Google Sheets.
 */
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

    // Populate dynamic UI controls from retrieved records
    populatePopularTags();
    populateCategories();

    // Render initial bookshelf grid
    renderBookshelf(libraryBooks);
  } catch (error) {
    console.error("[Polaris Error] Failed to fetch catalog:", error);
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

/**
 * Parses raw Google Visualization (GViz) response text into clean JSON objects.
 * @param {string} rawText - Raw text containing Google Query callback.
 * @returns {Array<Object>} Normalized list of row records.
 */
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

// ----------------------------------------------------------------------------
// 5. DYNAMIC TAXONOMY & METADATA POPULATION
// ----------------------------------------------------------------------------

/**
 * Extracts distinct tags recorded in the Pages database tab and renders filter pills.
 */
function populatePopularTags() {
  const tagsContainer = document.getElementById("dynamicTagsContainer");
  if (!tagsContainer) return;

  const rawTags = libraryPages.flatMap(p =>
    (p.tags || "").split(",").map(t => t.trim().toLowerCase()).filter(Boolean)
  );
  const distinctTags = [...new Set(rawTags)];

  if (distinctTags.length === 0) {
    tagsContainer.innerHTML = `<span class="text-slate-300 font-medium">Popular Tags:</span> <span class="text-xs text-slate-400">No tags recorded.</span>`;
    return;
  }

  tagsContainer.innerHTML = `
    <span class="text-slate-300 font-medium">Popular Tags:</span>
    ${distinctTags.map(tag => `
      <button type="button" 
              class="tag-filter-btn bg-white/10 hover:bg-white/20 text-slate-100 px-3.5 py-1 rounded-full border border-white/15 transition cursor-pointer font-mono text-[11px]" 
              data-tag="${tag}">
        #${tag}
      </button>
    `).join("")}
  `;

  // Attach click events for toggling tag filter
  tagsContainer.querySelectorAll(".tag-filter-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const selectedTag = e.target.getAttribute("data-tag");
      if (activeTagFilter === selectedTag) {
        activeTagFilter = null;
        e.target.classList.remove("ring-2", "ring-white", "bg-white/30");
      } else {
        tagsContainer.querySelectorAll(".tag-filter-btn").forEach(b => b.classList.remove("ring-2", "ring-white", "bg-white/30"));
        activeTagFilter = selectedTag;
        e.target.classList.add("ring-2", "ring-white", "bg-white/30");
      }
      applyFilters();
    });
  });
}

/**
 * Extracts distinct categories recorded in the Books database tab and renders category tabs.
 */
function populateCategories() {
  const categoryTabsContainer = document.getElementById("categoryTabs");
  if (!categoryTabsContainer) return;

  const distinctCategories = [...new Set(libraryBooks.map(b => (b.category || "").trim()).filter(Boolean))];

  const activePillClasses = "bg-polaris-primary-container text-white font-bold shadow-sm";
  const inactivePillClasses = "text-slate-700 font-normal hover:text-slate-900";

  categoryTabsContainer.innerHTML = `
    <button type="button" class="cat-pill px-4 py-1.5 rounded-full transition cursor-pointer ${activeCategoryFilter === 'ALL' ? activePillClasses : inactivePillClasses}" data-category="ALL">
      All Materials
    </button>
    ${distinctCategories.map(cat => `
      <button type="button" class="cat-pill px-4 py-1.5 rounded-full transition cursor-pointer ${activeCategoryFilter === cat ? activePillClasses : inactivePillClasses}" data-category="${cat}">
        ${cat}
      </button>
    `).join("")}
  `;

  categoryTabsContainer.querySelectorAll(".cat-pill").forEach(btn => {
    btn.addEventListener("click", (e) => {
      categoryTabsContainer.querySelectorAll(".cat-pill").forEach(b => {
        b.classList.remove("bg-polaris-primary-container", "text-white", "font-bold", "shadow-sm");
        b.classList.add("text-slate-700", "font-normal", "hover:text-slate-900");
      });

      e.currentTarget.classList.remove("text-slate-700", "font-normal", "hover:text-slate-900");
      e.currentTarget.classList.add("bg-polaris-primary-container", "text-white", "font-bold", "shadow-sm");

      activeCategoryFilter = e.currentTarget.getAttribute("data-category");
      applyFilters();
    });
  });
}

// ----------------------------------------------------------------------------
// 6. GLOBAL LIVE SEARCH & FILTER ENGINE
// ----------------------------------------------------------------------------

/**
 * Evaluates search query, category, and tag filters against memory store.
 */
function applyFilters() {
  const searchInput = document.getElementById("globalSearchInput");
  const query = (searchInput ? searchInput.value : "").trim().toLowerCase();

  const filtered = libraryBooks.filter(book => {
    const currentBookId = String(book.book_id || "").trim();
    const relatedPages = libraryPages.filter(p => String(p.book_id || "").trim() === currentBookId);

    // 1. Category Filter Match
    if (activeCategoryFilter !== "ALL") {
      const bCat = (book.category || "").trim().toLowerCase();
      if (bCat !== activeCategoryFilter.toLowerCase()) return false;
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

// ----------------------------------------------------------------------------
// 7. MANUAL COMPLETION TRACKING & GAMIFICATION
// ----------------------------------------------------------------------------

/**
 * Retrieves the current reading progress state from localStorage.
 * @returns {Object} Stored progress mapped by book_id.
 */
function getReadingProgress() {
  try {
    const saved = localStorage.getItem('polaris_reading_progress');
    return saved ? JSON.parse(saved) : {};
  } catch (e) {
    console.error("[Polaris Progress] Error reading localStorage:", e);
    return {};
  }
}

/**
 * Updates page completion state. Operates strictly as a counter:
 * Checked = 1 (completed), Unchecked = 0 (incomplete).
 * @param {string} pageId - Target page identifier.
 * @param {string} bookId - Parent book identifier.
 * @param {boolean} isChecked - Checkbox state.
 */
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
}

/**
 * Calculates current progress statistics for a given book.
 * @param {string} bookId - Target book identifier.
 * @param {number} totalPages - Total verified pages in the book.
 * @returns {Object} Progress counts and percentage.
 */
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

// ----------------------------------------------------------------------------
// 8. BOOKSHELF RENDERER
// ----------------------------------------------------------------------------

/**
 * Renders the catalog grid. Book IDs and internal POC are hidden from display.
 * @param {Array<Object>} books - List of books to render.
 */
function renderBookshelf(books) {
  const grid = document.getElementById("bookGrid");
  const shelfCount = document.getElementById("shelfCount");
  const shelfControls = document.getElementById("shelfControls");
  const ingestCallout = document.getElementById("ingestCallout");
  const heroSection = document.querySelector(".hero-section");

  if (shelfControls) shelfControls.classList.remove("hidden");
  if (ingestCallout) ingestCallout.classList.remove("hidden");
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

    // Progress stats
    const stats = calculateBookProgress(currentBookId, pageCount);

    // Status evaluation
    const rawBookStatus = (book.status || "ACTIVE").trim().toUpperCase();
    const isBookActive = rawBookStatus === "ACTIVE";

    // Left Status Pill
    const statusPill = isBookActive
      ? `<span class="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1 rounded-full"><span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Active</span>`
      : `<span class="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 bg-slate-100 border border-slate-200 px-3 py-1 rounded-full"><span class="w-1.5 h-1.5 rounded-full bg-slate-400"></span> Inactive</span>`;

    // Progress Bar stays visible at 100% and turns green
    const progressLabelLeft = stats.isCompleted
      ? `<span class="inline-flex items-center gap-1 font-bold text-emerald-700">✓ Complete</span>`
      : `<span>Reading Progress</span>`;

    const progressLabelRight = stats.isCompleted
      ? `<span class="font-mono font-bold text-emerald-700">${pageCount} of ${pageCount} Pages (100%)</span>`
      : `<span class="font-mono text-polaris-text-heading font-semibold">${stats.readPages} of ${pageCount} Pages (${stats.percentage}%)</span>`;

    const barFillColor = stats.isCompleted ? "bg-emerald-500" : "bg-polaris-primary-container";
    const barTrackBorder = stats.isCompleted ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-polaris-progress-track";

    const progressBlock = `
      <div class="mt-4 pt-3 border-t border-polaris-border-subtle">
        <div class="flex justify-between items-center text-xs text-polaris-text-muted mb-1.5 font-medium">
          ${progressLabelLeft}
          ${progressLabelRight}
        </div>
        <div class="w-full rounded-full h-2 overflow-hidden border ${barTrackBorder}">
          <div class="${barFillColor} h-2 rounded-full transition-all duration-500" style="width: ${stats.percentage}%"></div>
        </div>
      </div>
    `;

    // Pill-shaped action button + disabled behavior when Inactive
    const canOpen = isBookActive && Boolean(firstPageId);
    const actionClickAttr = canOpen ? `onclick="viewPage('${firstPageId}', '${currentBookId}')"` : "";

    const titleClasses = isBookActive
      ? "font-display font-semibold text-polaris-text-heading text-lg leading-snug mb-2 group-hover:text-polaris-primary-container cursor-pointer transition"
      : "font-display font-semibold text-slate-500 text-lg leading-snug mb-2 cursor-not-allowed";

    const pageActionButton = isBookActive
      ? `<button type="button" ${actionClickAttr} class="inline-flex items-center gap-1.5 text-xs font-semibold text-polaris-primary-container bg-polaris-primary-light hover:bg-indigo-100 border border-indigo-200 px-3.5 py-1 rounded-full transition cursor-pointer">
           ${pageCount} ${pageCount === 1 ? "Page" : "Pages"} →
         </button>`
      : `<button type="button" disabled aria-disabled="true" class="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 bg-slate-100 border border-slate-200 px-3.5 py-1 rounded-full cursor-not-allowed opacity-75 select-none">
           ${pageCount} ${pageCount === 1 ? "Page" : "Pages"} →
         </button>`;

    const cardBorderClasses = isBookActive
      ? "bg-polaris-card-bg border border-polaris-border-subtle rounded-xl p-6 hover:-translate-y-0.5 hover:shadow-elevation-2 transition-all duration-200 flex flex-col justify-between group"
      : "bg-slate-50/70 border border-slate-200/90 rounded-xl p-6 flex flex-col justify-between opacity-90";

    return `
      <div class="${cardBorderClasses}">
        <div>
          <div class="flex items-center justify-between mb-3">
            <span class="text-[10px] font-bold tracking-wider uppercase px-2 py-0.5 rounded-sm ${isBookActive ? 'bg-polaris-primary-light text-polaris-primary-container border border-indigo-100' : 'bg-slate-200/70 text-slate-600 border border-slate-300/60'} font-sans">
              ${book.category || "General"}
            </span>
          </div>

          <h3 ${actionClickAttr} class="${titleClasses}">
            ${book.title || "Untitled Book"}
          </h3>
          <p class="text-xs text-polaris-text-body line-clamp-2 leading-relaxed mb-4">
            ${book.description || "No description provided."}
          </p>
        </div>

        <div>
          ${progressBlock}
          <div class="flex items-center justify-between pt-4 mt-2 text-xs">
            ${statusPill}
            ${pageActionButton}
          </div>
        </div>
      </div>
    `;
  }).join("");
}

// ----------------------------------------------------------------------------
// 9. DEDICATED PAGE READER VIEW (LEFT SIDEBAR, MARKDOWN PARSER & UTILITIES)
// ----------------------------------------------------------------------------

/**
 * Sanitizes cell indentation / stray outer markdown fences and parses Markdown to HTML.
 * @param {string} rawMarkdown - Raw markdown string from Google Sheets.
 * @returns {string} Rendered HTML string.
 */
function renderMarkdownContent(rawMarkdown) {
  if (!rawMarkdown) {
    return '<p class="text-polaris-text-muted italic">No content available for this section.</p>';
  }

  // Strip accidental outer ```markdown ... ``` wrappers or trailing ``` from sheet cells
  let cleaned = String(rawMarkdown)
    .replace(/^```(?:markdown|md)?\s*\n?/i, "")
    .replace(/\n?```\s*$/g, "")
    .trim();

  // Remove uniform leading spaces so lines like "    # Heading" parse as headings, not code blocks
  cleaned = cleaned.replace(/^[ \t]+(?=#|>|-|\*|\d+\.)/gm, "");

  // Parse with marked.js if loaded, otherwise fallback to cleaned text
  if (typeof marked !== "undefined") {
    marked.setOptions({
      breaks: true,
      gfm: true
    });
    return marked.parse(cleaned);
  }

  return cleaned;
}

/**
 * Renders the reader view with a left chapter navigation sidebar and article content.
 * @param {string} pageId - Active page identifier.
 * @param {string} bookId - Parent playbook identifier.
 */
function viewPage(pageId, bookId) {
  const cleanPageId = String(pageId || "").trim();
  const page = libraryPages.find(p => String(p.page_id || "").trim() === cleanPageId);
  const activeBookId = String(bookId || (page ? page.book_id : "")).trim();
  const currentBook = libraryBooks.find(b => String(b.book_id || "").trim() === activeBookId);

  // Prevent opening or reviewing Inactive playbooks
  if (currentBook && String(currentBook.status || "ACTIVE").trim().toUpperCase() !== "ACTIVE") {
    return;
  }

  const pagesInBook = libraryPages.filter(p => String(p.book_id || "").trim() === activeBookId);
  const container = document.getElementById("bookGrid");
  const shelfControls = document.getElementById("shelfControls");
  const ingestCallout = document.getElementById("ingestCallout");
  const heroSection = document.querySelector(".hero-section");

  if (!page || !container) return;

  // Hide bookshelf discovery controls in reader mode
  if (shelfControls) shelfControls.classList.add("hidden");
  if (ingestCallout) ingestCallout.classList.add("hidden");
  if (heroSection) heroSection.classList.add("hidden");

  // Vertical chapter directory navigation for left sidebar
  const sidebarLinks = pagesInBook.map((p, idx) => {
    const isCurrent = String(p.page_id || "").trim() === cleanPageId;
    const activeClass = isCurrent
      ? "bg-polaris-primary-container text-white font-semibold shadow-sm"
      : "bg-white text-polaris-text-body hover:bg-slate-100 border border-slate-200 font-medium";
    return `
      <button onclick="viewPage('${String(p.page_id).trim()}', '${activeBookId}')" 
              class="w-full text-left px-3.5 py-2.5 rounded-lg text-xs transition cursor-pointer font-sans mb-1.5 flex items-center justify-between ${activeClass}">
        <span class="truncate">Chapter ${p.page_number || idx + 1}: ${p.title}</span>
        ${isCurrent ? '<span>•</span>' : ''}
      </button>
    `;
  }).join("");

  // Checkbox state: 1 if completed, 0 if incomplete
  const isPageDone = (getReadingProgress()[activeBookId] || []).includes(cleanPageId);

  // Status badge matching database value
  const rawStatus = (page.status || "PUBLISHED").toUpperCase();
  const statusBadge = rawStatus.includes("PENDING")
    ? `<span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300">⚠️ ${page.status}</span>`
    : `<span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-900 border border-emerald-300">✓ ${page.status}</span>`;

  // Standardized review dates (calculates +90 days if next review date is missing)
  let lastReviewed = page.last_reviewed_date || "N/A";
  let nextReview = page.next_review_due;

  if (!nextReview || nextReview === "N/A") {
    const baseDate = (lastReviewed !== "N/A" && !isNaN(new Date(lastReviewed).getTime()))
      ? new Date(lastReviewed)
      : new Date();
    baseDate.setDate(baseDate.getDate() + 90);
    nextReview = baseDate.toISOString().split("T")[0];
  }

  // Render tags associated with this page
  const pageTags = (page.tags || "").split(",").map(t => t.trim()).filter(Boolean);
  const tagsHtml = pageTags.length > 0
    ? `<div class="flex flex-wrap items-center gap-1.5">
         <span class="text-xs font-semibold text-slate-500 mr-1">Tags:</span>
         ${pageTags.map(t => `<span class="text-[11px] bg-slate-100 text-slate-600 px-2.5 py-0.5 rounded-full font-mono border border-slate-200">#${t}</span>`).join("")}
       </div>`
    : "";

  container.innerHTML = `
    <div class="col-span-full max-w-7xl mx-auto w-full pt-2">
      
      <!-- Top Banner Header -->
      <div class="bg-polaris-hero-dark text-white rounded-t-2xl px-6 py-4 flex flex-wrap items-center justify-between gap-4 border-b border-slate-800">
        <div class="flex items-center gap-3">
          <button type="button" onclick="exitReaderView()" class="text-xs text-indigo-300 hover:text-white inline-flex items-center gap-1.5 font-medium cursor-pointer transition">
            &larr; Back to Bookshelf
          </button>
          <span class="text-slate-600">|</span>
          <span class="font-display text-sm font-bold text-white">${currentBook ? currentBook.title : 'Playbook Active'}</span>
        </div>
        <div class="text-xs font-mono text-slate-400">
          Page ${page.page_number || 1} of ${pagesInBook.length}
        </div>
      </div>

      <!-- Split Screen Layout: Left Sidebar Navigation (3 cols) + Main Article Content (9 cols) -->
      <div class="grid grid-cols-1 md:grid-cols-12 bg-white border-x border-b border-polaris-border-subtle rounded-b-2xl shadow-elevation-1 min-h-[600px]">
        
        <!-- Left Sidebar: Chapter Navigation -->
        <aside class="md:col-span-3 border-r border-polaris-border-subtle p-5 bg-slate-50/70">
          <div class="sticky top-24">
            <h4 class="font-display text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">Playbook Directory</h4>
            <div class="space-y-1">
              ${sidebarLinks}
            </div>
          </div>
        </aside>

        <!-- Right Pane: Main Article Content -->
        <article class="md:col-span-9 p-6 sm:p-8 space-y-6">
          
          <!-- Document Control Governance Header -->
          <div class="bg-slate-50 border border-slate-200 rounded-xl p-5 text-xs text-polaris-text-body">
            <div class="flex items-center justify-between pb-3 border-b border-slate-200 mb-3">
              ${statusBadge}
              
              <!-- Checkbox Counter: Checked = 1 (complete), Unchecked = 0 (incomplete) -->
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
            
            <!-- Governance Fields Matching Database -->
            <div class="grid grid-cols-3 gap-4 font-mono text-[11px]">
              <div>
                <span class="block text-slate-500 font-sans uppercase text-[9px] font-bold">Version</span>
                <span class="font-bold text-polaris-text-heading">${page.version || 'v1.0'}</span>
              </div>
              <div>
                <span class="block text-slate-500 font-sans uppercase text-[9px] font-bold">Last Reviewed Date</span>
                <span class="font-bold text-polaris-text-heading">${lastReviewed}</span>
              </div>
              <div>
                <span class="block text-slate-500 font-sans uppercase text-[9px] font-bold">Next Review Date</span>
                <span class="font-bold text-polaris-text-heading">${nextReview}</span>
              </div>
            </div>
          </div>

          <!-- Page Heading -->
          <div>
            <h1 class="font-display text-2xl sm:text-3xl font-extrabold text-polaris-text-heading tracking-tight mb-2">${page.title || 'Untitled Page'}</h1>
            <p class="text-polaris-text-muted text-sm font-normal">Actionable guidelines and verified talk-tracks for frontline teams.</p>
          </div>

          <!-- Body Content Area (Parsed Markdown) -->
          <div class="prose prose-slate max-w-none text-polaris-text-body text-sm leading-relaxed font-sans
                      prose-headings:font-display prose-headings:text-polaris-text-heading prose-headings:font-bold
                      prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg prose-h3:mt-6 prose-h3:mb-2
                      prose-p:my-3 prose-strong:text-polaris-text-heading prose-strong:font-semibold
                      prose-blockquote:border-l-4 prose-blockquote:border-polaris-primary-container prose-blockquote:bg-polaris-primary-light/60 prose-blockquote:py-2 prose-blockquote:px-4 prose-blockquote:rounded-r-lg prose-blockquote:not-italic prose-blockquote:text-polaris-text-heading
                      prose-ol:list-decimal prose-ol:pl-5 prose-ul:list-disc prose-ul:pl-5 prose-li:my-1">
            ${renderMarkdownContent(page.body_markdown)}
          </div>

          <!-- Utility Actions (Relocated above Tags) -->
          <div class="pt-6 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div class="flex items-center gap-4 text-xs text-polaris-text-muted">
              <button onclick="navigator.clipboard.writeText(window.location.href); alert('Link copied!');" class="hover:text-polaris-primary-container font-medium cursor-pointer inline-flex items-center gap-1">
                📋 Copy Link
              </button>
              <button onclick="window.print()" class="hover:text-polaris-primary-container font-medium cursor-pointer inline-flex items-center gap-1">
                🖨️ Print / PDF
              </button>
              <a href="[https://docs.google.com/forms](https://docs.google.com/forms)" target="_blank" class="hover:text-polaris-primary-container font-medium inline-flex items-center gap-1">
                ✏️ Suggest Edit
              </a>
            </div>

            <!-- Page Tags -->
            <div>
              ${tagsHtml}
            </div>
          </div>

          <!-- Bottom Return Navigation -->
          <div class="pt-6 border-t border-slate-100 flex items-center justify-between">
            <button type="button" onclick="exitReaderView()" class="text-xs text-polaris-primary-container font-semibold hover:underline cursor-pointer">
              &larr; Back to Bookshelf
            </button>
            <span class="text-xs text-polaris-text-muted font-mono">End of Page ${page.page_number || 1}</span>
          </div>

        </article>
      </div>
    </div>
  `;
}

/**
 * Returns from the reader view to the main bookshelf catalog.
 */
function exitReaderView() {
  const heroSection = document.querySelector(".hero-section");
  if (heroSection) heroSection.classList.remove("hidden");
  renderBookshelf(libraryBooks);
}

// ----------------------------------------------------------------------------
// 10. GLOBAL EXPORTS (Ensures inline HTML attributes can access functions)
// ----------------------------------------------------------------------------
window.viewPage = viewPage;
window.exitReaderView = exitReaderView;
window.togglePageCompletion = togglePageCompletion;
window.renderBookshelf = renderBookshelf;