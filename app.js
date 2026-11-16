// ============================================================================
// PROJECT POLARIS — ENTERPRISE KNOWLEDGE & ENABLEMENT ENGINE (app.js)
// ============================================================================

// 1. DATABASE ENDPOINTS (Google Visualization API)
const SHEET_ID = "1lWB14GzVzE_14WMTsG_Rj71gXYowpDeyovovxau7iDg";
const BOOKS_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=Books`;
const PAGES_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=Pages`;

// 2. IN-MEMORY STATE
let libraryBooks = [];
let libraryPages = [];
let activeCategoryFilter = "ALL";
let activeTagFilter = null;

// ----------------------------------------------------------------------------
// 3. INITIALIZATION & DATA FETCH ENGINE
// ----------------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  initPolarisEngine();
});

async function initPolarisEngine() {
  try {
    const [booksRes, pagesRes] = await Promise.all([
      fetch(BOOKS_URL).then(r => r.text()),
      fetch(PAGES_URL).then(r => r.text())
    ]);

    libraryBooks = parseGvizResponse(booksRes);
    libraryPages = parseGvizResponse(pagesRes);

    renderDynamicTagPills();
    renderDynamicCategoryTabs();
    renderBookshelf(libraryBooks);
    bindSearchListener();
  } catch (err) {
    console.error("[Polaris Engine] Failed to load catalog:", err);
    const shelfCount = document.getElementById("shelfCount");
    if (shelfCount) shelfCount.textContent = "Error loading catalog";
  }
}

/**
 * Parses Google Visualization JSONP-style payload into clean objects.
 */
function parseGvizResponse(rawText) {
  const jsonStart = rawText.indexOf("{");
  const jsonEnd = rawText.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd === -1) return [];

  const parsed = JSON.parse(rawText.slice(jsonStart, jsonEnd + 1));
  const table = parsed.table;
  if (!table || !table.cols || !table.rows) return [];

  const headers = table.cols.map(col =>
    String(col.label || col.id || "").trim().toLowerCase().replace(/\s+/g, "_")
  );

  return table.rows.map(row => {
    const item = {};
    (row.c || []).forEach((cell, idx) => {
      const key = headers[idx];
      if (!key) return;
      item[key] = cell && cell.v !== null && cell.v !== undefined
        ? (cell.f && typeof cell.v === "string" && cell.v.startsWith("Date(") ? cell.f : cell.v)
        : "";
    });
    return item;
  });
}

// ----------------------------------------------------------------------------
// 4. HIGH-CONTRAST HERO TAG FILTER PILLS (#1E293B & #3B82F6)
// ----------------------------------------------------------------------------
function renderDynamicTagPills() {
  const container = document.getElementById("dynamicTagsContainer");
  if (!container) return;

  const tagSet = new Set();
  libraryPages.forEach(page => {
    (page.tags || "")
      .split(",")
      .map(t => t.trim().replace(/^#/, ""))
      .filter(Boolean)
      .forEach(tag => tagSet.add(tag));
  });

  const tags = Array.from(tagSet);
  if (tags.length === 0) {
    container.innerHTML = `<span class="text-slate-300 font-medium">Popular Tags:</span> <span class="text-xs text-slate-400 font-mono">No tags available</span>`;
    return;
  }

  const pillsHtml = tags.map(tag => {
    const isSelected = activeTagFilter && activeTagFilter.toLowerCase() === tag.toLowerCase();

    // High-contrast accessible states against dark navy hero (#0A1128 / #0F172A)
    const pillClasses = isSelected
      ? "bg-[#3B82F6] hover:bg-blue-500 text-white border border-blue-300 font-semibold shadow-sm ring-2 ring-blue-400/40"
      : "bg-[#1E293B] hover:bg-slate-700 text-[#F8FAFC] border border-slate-600 hover:border-slate-400 font-medium";

    const checkIcon = isSelected
      ? `<svg class="w-3.5 h-3.5 text-white shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M16.704 5.29a1 1 0 010 1.42l-7.25 7.25a1 1 0 01-1.415 0l-3.25-3.25a1 1 0 011.414-1.42l2.543 2.544 6.543-6.544a1 1 0 011.415 0z" clip-rule="evenodd"/></svg>`
      : "";

    return `
      <button type="button"
              onclick="toggleTagFilter('${tag.replace(/'/g, "\\'")}')"
              aria-pressed="${isSelected}"
              class="tag-filter-btn inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full font-mono text-xs transition cursor-pointer ${pillClasses}">
        ${checkIcon}
        <span>#${tag}</span>
      </button>
    `;
  }).join("");

  container.innerHTML = `
    <span class="text-[#F8FAFC] font-medium mr-1">Popular Tags:</span>
    ${pillsHtml}
  `;
}

function toggleTagFilter(tag) {
  if (activeTagFilter && activeTagFilter.toLowerCase() === tag.toLowerCase()) {
    activeTagFilter = null;
  } else {
    activeTagFilter = tag;
  }
  renderDynamicTagPills();
  applyFilters();
}

// ----------------------------------------------------------------------------
// 5. DYNAMIC CATEGORY TABS
// ----------------------------------------------------------------------------
function renderDynamicCategoryTabs() {
  const categoryTabsContainer = document.getElementById("categoryTabs");
  if (!categoryTabsContainer) return;

  const categories = Array.from(
    new Set(
      libraryBooks
        .map(b => String(b.category || "").trim())
        .filter(Boolean)
    )
  );

  const dynamicBtns = categories.map(cat => `
    <button type="button"
            class="cat-pill px-4 py-1.5 rounded-full text-slate-700 font-normal hover:text-slate-900 transition cursor-pointer"
            data-category="${cat}">
      ${cat}
    </button>
  `).join("");

  categoryTabsContainer.innerHTML = `
    <button type="button"
            class="cat-pill px-4 py-1.5 rounded-full bg-polaris-primary-container text-white font-bold shadow-sm transition cursor-pointer"
            data-category="ALL">
      All Materials
    </button>
    ${dynamicBtns}
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
function bindSearchListener() {
  const searchInput = document.getElementById("globalSearchInput");
  if (!searchInput) return;
  searchInput.addEventListener("input", () => applyFilters());
}

function applyFilters() {
  const searchInput = document.getElementById("globalSearchInput");
  const query = (searchInput ? searchInput.value : "").trim().toLowerCase();

  const filtered = libraryBooks.filter(book => {
    const currentBookId = String(book.book_id || "").trim();
    const relatedPages = libraryPages.filter(p => String(p.book_id || "").trim() === currentBookId);

    if (activeCategoryFilter !== "ALL") {
      const bCat = (book.category || "").trim().toLowerCase();
      if (bCat !== activeCategoryFilter.toLowerCase()) return false;
    }

    if (activeTagFilter) {
      const matchesTag = relatedPages.some(p => {
        const pageTags = (p.tags || "").toLowerCase().split(",").map(t => t.trim().replace(/^#/, ""));
        return pageTags.includes(activeTagFilter.toLowerCase());
      });
      if (!matchesTag) return false;
    }

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
function getReadingProgress() {
  try {
    const saved = localStorage.getItem("polaris_reading_progress");
    return saved ? JSON.parse(saved) : {};
  } catch (e) {
    console.error("[Polaris Progress] Error reading localStorage:", e);
    return {};
  }
}

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

  try {
    localStorage.setItem("polaris_reading_progress", JSON.stringify(progress));
  } catch (e) {
    console.error("[Polaris Progress] Error saving localStorage:", e);
  }
}

function calculateBookProgress(bookId, totalPages) {
  const cleanBookId = String(bookId || "").trim();
  const completedIds = getReadingProgress()[cleanBookId] || [];
  const validPageIds = new Set(
    libraryPages
      .filter(p => String(p.book_id || "").trim() === cleanBookId)
      .map(p => String(p.page_id || "").trim())
  );

  const readPages = completedIds.filter(id => validPageIds.has(id)).length;
  const safeTotal = Math.max(Number(totalPages) || validPageIds.size || 0, 0);
  const percentage = safeTotal > 0 ? Math.min(Math.round((readPages / safeTotal) * 100), 100) : 0;

  return {
    readPages,
    totalPages: safeTotal,
    percentage,
    isCompleted: safeTotal > 0 && readPages >= safeTotal
  };
}

// ----------------------------------------------------------------------------
// 8. BOOKSHELF CATALOG RENDERER
// ----------------------------------------------------------------------------
function renderBookshelf(books) {
  const grid = document.getElementById("bookGrid");
  const shelfControls = document.getElementById("shelfControls");
  const ingestCallout = document.getElementById("ingestCallout");
  const shelfCount = document.getElementById("shelfCount");

  if (!grid) return;

  if (shelfControls) shelfControls.classList.remove("hidden");
  if (ingestCallout) ingestCallout.classList.remove("hidden");

  grid.className = "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6";

  if (shelfCount) {
    shelfCount.textContent = `${books.length} ${books.length === 1 ? "Playbook" : "Playbooks"} Available`;
  }

  if (!books || books.length === 0) {
    grid.innerHTML = `
      <div class="col-span-full bg-white border border-polaris-border-subtle rounded-2xl p-10 text-center">
        <p class="font-display font-bold text-polaris-text-heading text-base">No matching playbooks found</p>
        <p class="text-xs text-polaris-text-muted mt-1">Try clearing your active tag filter or adjusting your search keywords.</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = books.map(book => {
    const currentBookId = String(book.book_id || "").trim();
    const relatedPages = libraryPages
      .filter(p => String(p.book_id || "").trim() === currentBookId)
      .sort((a, b) => (Number(a.page_number) || 0) - (Number(b.page_number) || 0));

    const pageCount = relatedPages.length || Number(book.total_pages) || 0;
    const firstPageId = relatedPages.length > 0 ? String(relatedPages[0].page_id).trim() : "";
    const stats = calculateBookProgress(currentBookId, pageCount);

    const rawBookStatus = String(book.status || "ACTIVE").trim().toUpperCase();
    const isBookActive = rawBookStatus === "ACTIVE";

    const statusPill = isBookActive
      ? `<span class="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full"><span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Active</span>`
      : `<span class="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 bg-slate-100 border border-slate-200 px-2.5 py-0.5 rounded-full"><span class="w-1.5 h-1.5 rounded-full bg-slate-400"></span> Inactive</span>`;

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
            <span class="text-[10px] font-bold tracking-wider uppercase px-2 py-0.5 rounded-sm ${isBookActive ? "bg-polaris-primary-light text-polaris-primary-container border border-indigo-100" : "bg-slate-200/70 text-slate-600 border border-slate-300/60"} font-sans">
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
// 9. DEDICATED PAGE READER VIEW (BREADCRUMB + GROUPED BOTTOM FOOTER ACTIONS)
// ----------------------------------------------------------------------------
function renderMarkdownContent(rawMarkdown) {
  let cleaned = String(rawMarkdown || "").trim();
  cleaned = cleaned.replace(/^```(?:markdown|md)?\s*/i, "").replace(/```\s*$/, "");
  cleaned = cleaned.replace(/^[ \t]+(?=#|>|-|\*|\d+\.)/gm, "");

  if (typeof marked !== "undefined" && typeof marked.parse === "function") {
    return marked.parse(cleaned);
  }
  return `<p>${cleaned.replace(/\n/g, "<br>")}</p>`;
}

function viewPage(pageId, bookId) {
  const cleanPageId = String(pageId || "").trim();
  const page = libraryPages.find(p => String(p.page_id || "").trim() === cleanPageId);
  const activeBookId = String(bookId || (page ? page.book_id : "")).trim();
  const currentBook = libraryBooks.find(b => String(b.book_id || "").trim() === activeBookId);

  if (currentBook && String(currentBook.status || "ACTIVE").trim().toUpperCase() !== "ACTIVE") {
    return;
  }

  const pagesInBook = libraryPages
    .filter(p => String(p.book_id || "").trim() === activeBookId)
    .sort((a, b) => (Number(a.page_number) || 0) - (Number(b.page_number) || 0));

  const container = document.getElementById("bookGrid");
  const shelfControls = document.getElementById("shelfControls");
  const ingestCallout = document.getElementById("ingestCallout");
  const heroSection = document.querySelector(".hero-section");

  if (!page || !container) return;

  if (shelfControls) shelfControls.classList.add("hidden");
  if (ingestCallout) ingestCallout.classList.add("hidden");
  if (heroSection) heroSection.classList.add("hidden");

  // Determine current chapter index & Next Chapter target
  const currentIdx = pagesInBook.findIndex(p => String(p.page_id || "").trim() === cleanPageId);
  const nextPage = currentIdx >= 0 && currentIdx < pagesInBook.length - 1 ? pagesInBook[currentIdx + 1] : null;
  const bookTitle = currentBook ? currentBook.title : "Playbook";
  const chapterNum = page.page_number || (currentIdx >= 0 ? currentIdx + 1 : 1);

  // Left sidebar chapter directory
  const sidebarLinks = pagesInBook.map((p, idx) => {
    const pId = String(p.page_id || "").trim();
    const isCurrent = pId === cleanPageId;
    const isCompletedItem = (getReadingProgress()[activeBookId] || []).includes(pId);
    const activeClass = isCurrent
      ? "bg-polaris-primary-container text-white font-semibold shadow-sm"
      : "bg-white text-polaris-text-body hover:bg-slate-100 border border-slate-200 font-medium";

    return `
      <button type="button"
              onclick="viewPage('${pId}', '${activeBookId}')"
              class="w-full text-left px-3.5 py-2.5 rounded-lg text-xs transition cursor-pointer font-sans mb-1.5 flex items-center justify-between gap-2 ${activeClass}">
        <span class="truncate">Chapter ${p.page_number || idx + 1}: ${p.title}</span>
        ${isCurrent ? "<span>•</span>" : (isCompletedItem ? `<span class="text-emerald-600 font-bold">✓</span>` : "")}
      </button>
    `;
  }).join("");

  // Completion state
  const isPageDone = (getReadingProgress()[activeBookId] || []).includes(cleanPageId);

  // Status badge
  const rawStatus = String(page.status || "PUBLISHED").toUpperCase();
  const statusBadge = rawStatus.includes("PENDING")
    ? `<span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300">⚠️ ${page.status}</span>`
    : `<span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-900 border border-emerald-300">✓ ${page.status}</span>`;

  // Standardized review dates (+90 days fallback)
  let lastReviewed = page.last_reviewed_date || "N/A";
  let nextReview = page.next_review_due;
  if (!nextReview || nextReview === "N/A") {
    const baseDate = (lastReviewed !== "N/A" && !isNaN(new Date(lastReviewed).getTime()))
      ? new Date(lastReviewed)
      : new Date();
    baseDate.setDate(baseDate.getDate() + 90);
    nextReview = baseDate.toISOString().split("T")[0];
  }

  // Page tags
  const pageTags = (page.tags || "").split(",").map(t => t.trim().replace(/^#/, "")).filter(Boolean);
  const tagsHtml = pageTags.length > 0
    ? `<div class="flex flex-wrap items-center gap-1.5">
         <span class="text-xs font-semibold text-slate-500 mr-1">Tags:</span>
         ${pageTags.map(t => `<span class="text-[11px] bg-slate-100 text-slate-700 px-2.5 py-0.5 rounded-full font-mono border border-slate-200">#${t}</span>`).join("")}
       </div>`
    : "";

  // Next Chapter button (or Finish action on final chapter)
  const nextChapterButtonHtml = nextPage
    ? `<button type="button"
               onclick="viewPage('${String(nextPage.page_id).trim()}', '${activeBookId}')"
               class="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-polaris-primary-container hover:bg-indigo-700 text-white shadow-sm transition cursor-pointer">
         <span>Next Chapter</span>
         <span>→</span>
       </button>`
    : `<button type="button"
               onclick="exitReaderView()"
               class="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white shadow-sm transition cursor-pointer">
         <span>Finish &amp; Return to Bookshelf</span>
         <span>✓</span>
       </button>`;

  container.className = "block w-full";
  container.innerHTML = `
    <div class="w-full">
      <!-- Top Breadcrumb Trail (Replaces duplicate top Back button) -->
      <nav aria-label="Breadcrumb" class="mb-6 flex flex-wrap items-center gap-2 text-xs text-polaris-text-muted">
        <button type="button" onclick="exitReaderView()" class="font-semibold text-polaris-primary-container hover:underline cursor-pointer">
          Bookshelf
        </button>
        <span class="text-slate-400">/</span>
        <span class="font-medium text-polaris-text-heading truncate max-w-xs sm:max-w-md">${bookTitle}</span>
        <span class="text-slate-400">/</span>
        <span class="font-mono text-slate-500">Chapter ${chapterNum}</span>
      </nav>

      <!-- Split Reader Grid -->
      <div class="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
        
        <!-- Left Sidebar: Chapter Navigation Directory -->
        <aside class="md:col-span-3 bg-white border border-polaris-border-subtle rounded-2xl p-4 shadow-elevation-1 md:sticky md:top-20">
          <div class="text-[11px] font-mono uppercase tracking-wider text-polaris-text-muted mb-3 px-1">
            Chapters (${pagesInBook.length})
          </div>
          <div>
            ${sidebarLinks}
          </div>
        </aside>

        <!-- Main Lesson Card -->
        <article class="md:col-span-9 bg-white border border-polaris-border-subtle rounded-2xl p-6 sm:p-8 shadow-elevation-1 space-y-6">
          
          <!-- Document Control Governance Header (Completion toggle moved to footer) -->
          <div class="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
            <div class="flex flex-wrap items-center gap-3">
              ${statusBadge}
              <span><strong class="text-slate-800">Version:</strong> ${page.version || "v1.0"}</span>
            </div>
            <div class="flex flex-wrap items-center gap-4 font-mono text-[11px] text-slate-500">
              <span><strong class="text-slate-700 font-sans">Last Reviewed:</strong> ${lastReviewed}</span>
              <span><strong class="text-slate-700 font-sans">Next Review:</strong> ${nextReview}</span>
            </div>
          </div>

          <!-- Lesson Title -->
          <header class="border-b border-slate-100 pb-4">
            <div class="text-xs font-mono text-polaris-primary-container font-semibold uppercase tracking-wide mb-1">
              Chapter ${chapterNum} of ${pagesInBook.length}
            </div>
            <h1 class="font-display text-2xl sm:text-3xl font-bold text-polaris-text-heading leading-tight">
              ${page.title || "Untitled Chapter"}
            </h1>
          </header>

          <!-- Parsed Markdown Lesson Body -->
          <div class="prose prose-slate max-w-none prose-headings:font-display prose-headings:text-polaris-text-heading prose-a:text-polaris-primary-container">
            ${renderMarkdownContent(page.body_markdown)}
          </div>

          <!-- Utility Actions & Tags -->
          <div class="pt-6 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div class="flex items-center gap-4 text-xs text-polaris-text-muted">
              <button type="button" onclick="navigator.clipboard.writeText(window.location.href); alert('Link copied!');" class="hover:text-polaris-primary-container font-medium cursor-pointer inline-flex items-center gap-1">
                📋 Copy Link
              </button>
              <button type="button" onclick="window.print()" class="hover:text-polaris-primary-container font-medium cursor-pointer inline-flex items-center gap-1">
                🖨️ Print / PDF
              </button>
              <a href="https://docs.google.com/forms" target="_blank" class="hover:text-polaris-primary-container font-medium inline-flex items-center gap-1">
                ✏️ Suggest Edit
              </a>
            </div>
            <div>
              ${tagsHtml}
            </div>
          </div>

          <!-- Bottom Footer: Single Left Back Link + Grouped Right Completion & Next Chapter Actions -->
          <div class="pt-6 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <button type="button" onclick="exitReaderView()" class="text-xs text-polaris-primary-container font-semibold hover:underline cursor-pointer inline-flex items-center gap-1 self-start sm:self-auto">
              ← Back to Bookshelf
            </button>

            <div class="flex flex-wrap items-center gap-3 self-end sm:self-auto">
              <!-- Relocated Completion Checkbox Action -->
              <label for="pageCompleteCheckbox"
                     class="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border text-xs font-semibold cursor-pointer select-none transition ${isPageDone ? "bg-emerald-50 border-emerald-300 text-emerald-800" : "bg-slate-50 hover:bg-slate-100 border-slate-300 text-slate-700"}">
                <input type="checkbox"
                       id="pageCompleteCheckbox"
                       ${isPageDone ? "checked" : ""}
                       onchange="handleReaderCompletionToggle('${cleanPageId}', '${activeBookId}', this.checked)"
                       class="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 cursor-pointer">
                <span>${isPageDone ? "Completed" : "Mark as Completed"}</span>
              </label>

              <!-- Side-by-Side Next Chapter Action -->
              ${nextChapterButtonHtml}
            </div>
          </div>

        </article>
      </div>
    </div>
  `;

  window.scrollTo({ top: 0, behavior: "smooth" });
}

/**
 * Updates completion state and re-renders the active reader footer & sidebar indicator immediately.
 */
function handleReaderCompletionToggle(pageId, bookId, isChecked) {
  togglePageCompletion(pageId, bookId, isChecked);
  viewPage(pageId, bookId);
}

function exitReaderView() {
  const heroSection = document.querySelector(".hero-section");
  if (heroSection) heroSection.classList.remove("hidden");
  applyFilters();
}

// ----------------------------------------------------------------------------
// 10. GLOBAL EXPORTS
// ----------------------------------------------------------------------------
window.viewPage = viewPage;
window.exitReaderView = exitReaderView;
window.togglePageCompletion = togglePageCompletion;
window.handleReaderCompletionToggle = handleReaderCompletionToggle;
window.toggleTagFilter = toggleTagFilter;
window.renderBookshelf = renderBookshelf;