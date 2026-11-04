// --- CONFIGURATION & ENDPOINTS ---
const SPREADSHEET_ID = "1lWB14GzVzE_14WMTsG_Rj71gXYowpDeyovovxau7iDg";
const BOOKS_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&sheet=Books`;
const PAGES_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&sheet=Pages`;

// In-memory data store
let libraryBooks = [];
let libraryPages = [];
let activeTagFilter = null;

// --- INITIALIZATION ---
document.addEventListener("DOMContentLoaded", () => {
  initSearchAndFilters();
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
  const cols = data.table.cols.map(c => (c.label || c.id).trim().toLowerCase());
  
  return data.table.rows.map(row => {
    let item = {};
    row.c.forEach((cell, i) => {
      item[cols[i]] = cell ? (cell.f || cell.v) : "";
    });
    return item;
  });
}

// --- SEARCH & FILTER CONTROLLER ---
function initSearchAndFilters() {
  const searchInput = document.getElementById("globalSearchInput");

  // Real-time search as user types
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      applyFilters();
    });
  }

  // Hook up tag buttons/pills
  document.querySelectorAll(".tag-filter-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const selectedTag = e.target.getAttribute("data-tag") || e.target.innerText.replace("#", "").trim();
      
      // Toggle filter on/off
      if (activeTagFilter === selectedTag) {
        activeTagFilter = null;
        e.target.classList.remove("ring-2", "ring-white");
      } else {
        document.querySelectorAll(".tag-filter-btn").forEach(b => b.classList.remove("ring-2", "ring-white"));
        activeTagFilter = selectedTag;
        e.target.classList.add("ring-2", "ring-white");
      }

      applyFilters();
    });
  });
}

function applyFilters() {
  const searchInput = document.getElementById("globalSearchInput");
  const query = (searchInput ? searchInput.value : "").trim().toLowerCase();

  const filtered = libraryBooks.filter(book => {
    // 1. Check child pages belonging to this book
    const currentBookId = String(book.book_id || "").trim();
    const relatedPages = libraryPages.filter(p => String(p.book_id || "").trim() === currentBookId);

    // 2. Evaluate Tag Filter (if active)
    let matchesTag = true;
    if (activeTagFilter) {
      matchesTag = relatedPages.some(p => {
        const pageTags = (p.tags || "").toLowerCase().split(",").map(t => t.trim());
        return pageTags.includes(activeTagFilter.toLowerCase());
      });
    }

    if (!matchesTag) return false;

    // 3. Evaluate Search Query Match
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

// --- SESSION 8: GAMIFICATION & PROGRESS LOGIC ---
function getReadingProgress() {
  try {
    const saved = localStorage.getItem('polaris_reading_progress');
    return saved ? JSON.parse(saved) : {};
  } catch (e) {
    console.error("Error reading localStorage:", e);
    return {};
  }
}

function markPageAsRead(bookId, pageId) {
  if (!bookId || !pageId) return;
  const cleanBookId = String(bookId).trim();
  const cleanPageId = String(pageId).trim();

  const progress = getReadingProgress();
  if (!progress[cleanBookId]) {
    progress[cleanBookId] = [];
  }
  if (!progress[cleanBookId].includes(cleanPageId)) {
    progress[cleanBookId].push(cleanPageId);
    localStorage.setItem('polaris_reading_progress', JSON.stringify(progress));
  }
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

// --- BOOKSHELF RENDERER ---
function renderBookshelf(books) {
  const grid = document.getElementById("bookGrid");
  const shelfCount = document.getElementById("shelfCount");

  if (shelfCount) {
    const total = books.length;
    let label = total === 1 ? "1 Playbook" : `${total} Playbooks`;
    if (activeTagFilter) label += ` (Filtered by #${activeTagFilter})`;
    shelfCount.innerText = `${label} Available`;
  }

  if (!grid) return;

  if (books.length === 0) {
    grid.innerHTML = `
      <div class="col-span-full py-12 text-center text-slate-400">
        <p class="text-base font-medium text-slate-600">No matching playbooks found</p>
        <p class="text-xs mt-1">Try adjusting your search query or removing active tag filters.</p>
      </div>`;
    return;
  }

  grid.innerHTML = books.map(book => {
    const currentBookId = String(book.book_id || "").trim();
    const bookPages = libraryPages.filter(p => String(p.book_id || "").trim() === currentBookId);
    const pageCount = bookPages.length;
    const firstPageId = pageCount > 0 ? String(bookPages[0].page_id).trim() : null;

    // Calculate reading stats dynamically from localStorage
    const stats = calculateBookProgress(currentBookId, pageCount);

    const stampBadge = stats.isCompleted 
      ? `<div class="absolute top-3 right-3 bg-amber-500 text-white text-[10px] font-bold uppercase px-2.5 py-1 rounded-md shadow-md tracking-wider flex items-center gap-1 z-10 animate-fade-in">
           <span>🌟</span> Gold Stamp Awarded
         </div>` 
      : '';

    const progressBar = `
      <div class="mt-4 pt-3 border-t border-slate-100">
        <div class="flex justify-between text-xs text-slate-500 mb-1">
          <span>Reading Progress</span>
          <span class="font-medium ${stats.isCompleted ? 'text-amber-600 font-bold' : ''}">
            ${stats.readPages} of ${pageCount} Pages (${stats.percentage}%)
          </span>
        </div>
        <div class="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
          <div class="${stats.isCompleted ? 'bg-amber-500' : 'bg-brand-600'} h-2 rounded-full transition-all duration-500" style="width: ${stats.percentage}%"></div>
        </div>
      </div>
    `;

    const actionClick = firstPageId 
      ? `viewPage('${firstPageId}', '${currentBookId}')` 
      : `alert('No pages published for this playbook yet.')`;

    return `
      <div class="relative bg-white border border-slate-200 rounded-xl p-5 hover:border-brand-500 hover:shadow-md transition flex flex-col justify-between">
        ${stampBadge}
        <div>
          <div class="flex items-center justify-between mb-3">
            <span class="text-[10px] font-semibold tracking-wider uppercase px-2 py-0.5 rounded bg-brand-50 text-brand-700 border border-brand-100">
              ${book.category || "General"}
            </span>
            <span class="text-xs font-mono text-slate-400">${currentBookId}</span>
          </div>
          <h3 onclick="${actionClick}" class="font-bold text-slate-800 text-base leading-snug mb-1 hover:text-brand-600 cursor-pointer transition">
            ${book.title || "Untitled Book"}
          </h3>
          <p class="text-xs text-slate-500 line-clamp-2 mb-4">${book.description || "No description provided."}</p>
        </div>

        <div>
          ${progressBar}
          <div class="flex items-center justify-between pt-3 text-xs text-slate-400">
            <span>POC: ${book.owner_poc || "Unassigned"}</span>
            <button type="button" onclick="${actionClick}" class="font-medium text-brand-600 hover:underline cursor-pointer">
              ${pageCount} ${pageCount === 1 ? "Page" : "Pages"} &rarr;
            </button>
          </div>
        </div>
      </div>
    `;
  }).join("");
}

// --- GOVERNANCE & DOCUMENT CONTROL HEADER ---
function renderDocumentControlHeader(page) {
  const today = new Date();
  const reviewDueDate = new Date(page.next_review_due);
  const isStale = today > reviewDueDate || page.status === "PENDING_REVIEW";

  const statusBadge = isStale 
    ? `<span class="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-amber-100 text-amber-800 border border-amber-300">⚠️ PENDING REVIEW (Stale)</span>`
    : `<span class="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300">✅ PUBLISHED</span>`;

  return `
    <div class="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-6 text-xs text-slate-600 flex flex-wrap items-center justify-between gap-4 shadow-sm">
      <div class="flex items-center gap-3">
        ${statusBadge}
        <span><strong>Version:</strong> ${page.version || 'v1.0'}</span>
        <span><strong>Owner:</strong> ${page.document_owner || 'SME - Sales Ops'}</span>
      </div>
      <div class="flex items-center gap-3 text-slate-500 font-mono">
        <span><strong>Last Reviewed:</strong> ${page.last_reviewed_date || 'N/A'}</span>
        <span><strong>Next Review:</strong> ${page.next_review_due || 'N/A'}</span>
      </div>
    </div>
  `;
}

// --- PAGE VIEW RENDERER WITH AUTOMATIC MARK-AS-READ ---
function viewPage(pageId, bookId) {
  const cleanPageId = String(pageId || "").trim();
  const page = libraryPages.find(p => String(p.page_id || "").trim() === cleanPageId);
  const activeBookId = String(bookId || (page ? page.book_id : "")).trim();
  
  if (page && activeBookId) {
    markPageAsRead(activeBookId, page.page_id);
  }

  const pagesInBook = libraryPages.filter(p => String(p.book_id || "").trim() === activeBookId);
  const container = document.getElementById("bookGrid");
  const shelfCount = document.getElementById("shelfCount");

  if (!page || !container) return;

  if (shelfCount) {
    shelfCount.innerText = `Viewing Page: ${page.page_id} (${pagesInBook.length} in Playbook)`;
  }

  const pageTabs = pagesInBook.map(p => {
    const isActive = String(p.page_id || "").trim() === cleanPageId;
    const activeClass = isActive 
      ? "bg-brand-600 text-white font-semibold shadow-sm" 
      : "bg-slate-100 text-slate-700 hover:bg-slate-200";
    return `
      <button onclick="viewPage('${String(p.page_id).trim()}', '${activeBookId}')" 
              class="px-3 py-1.5 rounded-lg text-xs transition cursor-pointer ${activeClass}">
        Page ${p.page_number || ''}: ${p.title}
      </button>
    `;
  }).join("");

  container.innerHTML = `
    <div class="col-span-full max-w-4xl mx-auto w-full bg-white rounded-2xl border border-slate-200 p-8 shadow-sm">
      <div class="flex flex-wrap items-center justify-between gap-3 mb-6 pb-4 border-b border-slate-100">
        <button type="button" onclick="renderBookshelf(libraryBooks)" class="text-xs text-brand-600 hover:underline inline-flex items-center gap-1 font-medium cursor-pointer">
          &larr; Back to Bookshelf
        </button>
        <div class="flex flex-wrap gap-2">
          ${pageTabs}
        </div>
      </div>

      ${renderDocumentControlHeader(page)}

      <h1 class="text-2xl font-bold text-slate-900 mb-2">${page.title || 'Untitled Page'}</h1>
      <div class="flex items-center gap-2 mb-6">
        <span class="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-mono">${page.page_id}</span>
        <span class="text-xs text-slate-400 font-mono">Book: ${page.book_id}</span>
      </div>

      <div class="prose max-w-none text-slate-700 whitespace-pre-wrap leading-relaxed text-sm">
        ${page.body_markdown || 'No content available.'}
      </div>
    </div>
  `;
}