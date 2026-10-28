// --- CONFIGURATION ---
const SHEET_ID = "1lWB14GzVzE_14WMTsG_Rj71gXYowpDeyovovxau7iDg";
const BOOKS_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=Books`;
const PAGES_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=Pages`;

// State containers
let libraryBooks = [];
let libraryPages = [];

// DOM Elements
const bookGrid = document.getElementById("bookGrid");
const shelfCount = document.getElementById("shelfCount");

/**
 * Parses raw Google Visualization API response text into clean JSON objects
 */
function parseGvizResponse(rawText) {
  // GViz wraps JSON in: /*O_o*/ google.visualization.Query.setResponse({...});
  const jsonStart = rawText.indexOf("{");
  const jsonEnd = rawText.lastIndexOf("}") + 1;
  const jsonString = rawText.substring(jsonStart, jsonEnd);
  const data = JSON.parse(jsonString);

  const cols = data.table.cols.map(c => (c ? c.label : ""));
  return data.table.rows.map(row => {
    const rowObj = {};
    row.c.forEach((cell, idx) => {
      const colName = cols[idx] || `col_${idx}`;
      rowObj[colName] = cell && cell.v !== null ? cell.v : "";
    });
    return rowObj;
  });
}

/**
 * Fetches all books and pages from Google Sheets
 */
async function fetchCatalog() {
  try {
    if (shelfCount) shelfCount.textContent = "Connecting to database...";

    // Concurrent fetch for high performance
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
    console.error("Fetch Engine Error:", error);
    if (shelfCount) shelfCount.textContent = "Error loading database";
    if (bookGrid) {
      bookGrid.innerHTML = `
        <div class="col-span-full p-6 bg-red-50 border border-red-200 text-red-700 rounded-xl text-center">
          <p class="font-bold">Failed to load catalog.</p>
          <p class="text-xs mt-1">Verify that your Polaris_Database Google Sheet sharing is set to "Anyone with the link can view".</p>
        </div>
      `;
    }
  }
}

/**
 * Renders parent book cards dynamically into the HTML grid
 */
function renderBookshelf(books) {
  if (!bookGrid) return;
  bookGrid.innerHTML = "";

  if (books.length === 0) {
    bookGrid.innerHTML = `<p class="col-span-full text-slate-400 text-center py-8">No playbooks found in database.</p>`;
    if (shelfCount) shelfCount.textContent = "0 Playbooks available";
    return;
  }

  if (shelfCount) {
    shelfCount.textContent = `${books.length} Playbook${books.length > 1 ? "s" : ""} Available`;
  }

  books.forEach(book => {
    // Count associated pages dynamically from the pages state
    const pageCount = libraryPages.filter(p => p.book_id === book.book_id).length;

    const card = document.createElement("div");
    card.className = "bg-white rounded-xl border border-slate-200 p-6 shadow-sm hover:shadow-md transition flex flex-col justify-between";
    card.innerHTML = `
      <div>
        <div class="flex items-center justify-between mb-2">
          <span class="text-xs font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
            ${book.category || "General"}
          </span>
          <span class="text-xs font-mono text-slate-400">${book.book_id || "N/A"}</span>
        </div>
        <h3 class="font-bold text-slate-900 text-lg hover:text-brand-600 cursor-pointer transition">
          ${book.title || "Untitled Book"}
        </h3>
        <p class="text-slate-600 text-sm mt-2 line-clamp-2">
          ${book.description || "No description provided."}
        </p>
      </div>
      <div class="pt-6 mt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
        <span>Owner: ${book.owner_poc || "L&D Team"}</span>
        <span class="font-medium text-brand-600 hover:underline cursor-pointer">
          ${pageCount} Page${pageCount === 1 ? "" : "s"} &rarr;
        </span>
      </div>
    `;
    bookGrid.appendChild(card);
  });
}

// Initialize on page load
document.addEventListener("DOMContentLoaded", fetchCatalog);