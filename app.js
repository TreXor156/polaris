/**
 * ============================================================================
 * PROJECT POLARIS - ENTERPRISE KNOWLEDGE & ENABLEMENT ENGINE (app.js)
 * ============================================================================
 * Architecture:
 * - Headless CMS via Google Sheets GViz JSON API
 * - Apps Script Web App Sync (doGet Login & Progress / doPost Save)
 * - Role-Based UI Visibility (Learner, Creator, Admin)
 * - Dynamic Library Card & Gamification Badges
 * - Breadcrumb Reader, Grouped Bottom-Right Footer Actions & High-Contrast Tags
 * ============================================================================
 */

// ----------------------------------------------------------------------------
// 1. CONFIGURATION & ENDPOINTS
// ----------------------------------------------------------------------------
const SPREADSHEET_ID = "1lWB14GzVzE_14WMTsG_Rj71gXYowpDeyovovxau7iDg";
const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbwKp3lgAXmIfLP84hm6vveNnO_xIFGJwRkjKOZMJFWAsrdbHJQU6-v0pz3i73z0J9In/exec";

const BOOKS_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&sheet=Books`;
const PAGES_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&sheet=Pages`;

// ----------------------------------------------------------------------------
// 2. IN-MEMORY STATE STORE
// ----------------------------------------------------------------------------
let libraryBooks = [];
let libraryPages = [];
let activeTagFilter = null;
let activeCategoryFilter = "ALL";
let currentUser = null;
let showAllTags = false;
const MAX_VISIBLE_TAGS = 12; 

// ----------------------------------------------------------------------------
// 3. APPLICATION INITIALIZATION & IDENTITY GATE
// ----------------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  const searchInput = document.getElementById("globalSearchInput");
  if (searchInput) {
    searchInput.addEventListener("input", () => applyFilters());
  }

  const loginForm = document.getElementById("loginForm");
  if (loginForm) {
    loginForm.addEventListener("submit", handleLoginSubmit);
  }

  checkAuthenticationState();
});

/**
 * Checks if a verified user session exists in localStorage.
 * Shows Identity Gate Modal if unauthenticated; otherwise boots catalog.
 */
function checkAuthenticationState() {
  const gateModal = document.getElementById("identityGateModal");
  try {
    const savedUser = localStorage.getItem("polaris_user");
    if (savedUser) {
      currentUser = JSON.parse(savedUser);
      if (gateModal) gateModal.classList.add("hidden");
      applyRoleVisibility(currentUser.role);
      updateNavPatronHeader();
      fetchCatalog();
      // Refresh progress silently from Sheets in background
      syncUserFromBackend(currentUser.email, true);
      return;
    }
  } catch (e) {
    console.error("[Polaris Auth] Failed to parse saved user:", e);
  }

  // No active user -> show Identity Gate Modal
  if (gateModal) gateModal.classList.remove("hidden");
}

/**
 * Handles login form submission against Apps Script doGet endpoint.
 */
async function handleLoginSubmit(e) {
  e.preventDefault();
  const emailInput = document.getElementById("loginEmailInput");
  const errorBox = document.getElementById("loginErrorBox");
  const submitBtn = document.getElementById("loginSubmitBtn");

  const email = (emailInput ? emailInput.value : "").trim().toLowerCase();
  if (!email) return;

  if (errorBox) errorBox.classList.add("hidden");
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<span>Verifying Patron...</span>`;
  }

  const result = await syncUserFromBackend(email, false);

  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.innerHTML = `<span>Enter Library</span><span>&rarr;</span>`;
  }

  if (result.success) {
    const gateModal = document.getElementById("identityGateModal");
    if (gateModal) gateModal.classList.add("hidden");
    applyRoleVisibility(currentUser.role);
    updateNavPatronHeader();
    fetchCatalog();
  } else {
    if (errorBox) {
      errorBox.innerText = result.message || "Unable to verify email. Check with your Admin.";
      errorBox.classList.remove("hidden");
    }
  }
}

/**
 * Auto-fills the email input with a demo persona credential and submits immediately.
 */
function loginAsDemo(email) {
  const emailInput = document.getElementById("loginEmailInput");
  const loginForm = document.getElementById("loginForm");
  if (!emailInput || !loginForm) return;

  emailInput.value = email;
  if (typeof loginForm.requestSubmit === "function") {
    loginForm.requestSubmit();
  } else {
    loginForm.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  }
}

/**
 * Calls Apps Script doGet(e) to verify user and pull synced User_Progress.
 */
async function syncUserFromBackend(email, isSilent = false) {
  if (!WEB_APP_URL || WEB_APP_URL.includes("YOUR_DEPLOYED_WEB_APP_URL")) {
    return {
      success: false,
      message: "WEB_APP_URL is not configured yet in app.js (line 16)."
    };
  }

  try {
    const url = `${WEB_APP_URL}?action=login&email=${encodeURIComponent(email)}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.status === "success" && data.user) {
      currentUser = {
        user_id: String(data.user.user_id || "").trim(),
        email: String(data.user.email || email).trim(),
        full_name: String(data.user.full_name || "Patron").trim(),
        role: String(data.user.role || "LEARNER").trim().toUpperCase(),
        department: String(data.user.department || "General").trim()
      };

      localStorage.setItem("polaris_user", JSON.stringify(currentUser));

      if (data.progress && typeof data.progress === "object") {
        localStorage.setItem("polaris_reading_progress", JSON.stringify(data.progress));
      }

      if (isSilent && libraryBooks.length > 0) {
        updateNavPatronHeader();
        renderBookshelf(libraryBooks);
      }

      return { success: true };
    } else {
      return { success: false, message: data.message || "Patron not found or inactive." };
    }
  } catch (err) {
    console.error("[Polaris Sync] Login/Sync error:", err);
    return { success: false, message: "Network error connecting to Polaris backend." };
  }
}

/**
 * Signs out the current patron and re-opens the Identity Gate.
 */
function logoutUser() {
  localStorage.removeItem("polaris_user");
  localStorage.removeItem("polaris_reading_progress");
  currentUser = null;
  closeLibraryCard();
  const gateModal = document.getElementById("identityGateModal");
  if (gateModal) gateModal.classList.remove("hidden");
}

// ----------------------------------------------------------------------------
// 4. ROLE-BASED UI VISIBILITY (Learner, Creator, Admin)
// ----------------------------------------------------------------------------
function applyRoleVisibility(role) {
  const normalizedRole = String(role || "LEARNER").trim().toUpperCase();

  document.querySelectorAll("[data-role]").forEach(el => {
    const allowedRoles = el
      .getAttribute("data-role")
      .split(",")
      .map(r => r.trim().toUpperCase());

    if (allowedRoles.includes(normalizedRole)) {
      el.classList.remove("hidden");
    } else {
      el.classList.add("hidden");
    }
  });
}

function formatRoleLabel(role) {
  const r = String(role || "LEARNER").trim().toLowerCase();
  return r.charAt(0).toUpperCase() + r.slice(1);
}

function updateNavPatronHeader() {
  if (!currentUser) return;

  const deptPill = document.getElementById("navDeptPill");
  if (deptPill) {
    deptPill.innerText = `${currentUser.department} • ${formatRoleLabel(currentUser.role)}`;
  }

  const badgeText = document.getElementById("navUserBadgeText");
  if (badgeText) {
    const firstName = currentUser.full_name.split(" ")[0];
    const gamification = calculatePatronStats();
    badgeText.innerText = `${firstName} • ${gamification.rankTitle}`;
  }
}

// ----------------------------------------------------------------------------
// 5. DATA RETRIEVAL & GVIZ PARSER
// ----------------------------------------------------------------------------
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

    populatePopularTags();
    populateCategories();
    updateNavPatronHeader();
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
// 6. HIGH-CONTRAST HERO TAG FILTER PILLS (#1E293B & #3B82F6) & CATEGORIES
// ----------------------------------------------------------------------------
function populatePopularTags() {
  const tagsContainer = document.getElementById("dynamicTagsContainer");
  if (!tagsContainer) return;

  // 1. Count frequency of each tag across all pages
  const tagCounts = new Map();
  libraryPages.forEach(p => {
    (p.tags || "")
      .split(",")
      .map(t => t.trim().replace(/^#/, "").toLowerCase())
      .filter(Boolean)
      .forEach(tag => {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      });
  });

  // 2. Sort tags by usage count descending (then alphabetically on ties)
  const sortedTags = Array.from(tagCounts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag]) => tag);

  if (sortedTags.length === 0) {
    tagsContainer.innerHTML = `<span class="text-[#F8FAFC] font-medium">Popular Tags:</span> <span class="text-xs text-slate-300 font-mono">No tags recorded.</span>`;
    return;
  }

  // 3. Slice to top N unless expanded (or if activeTagFilter is outside top N)
  const hasMoreTags = sortedTags.length > MAX_VISIBLE_TAGS;
  const activeIdx = activeTagFilter
    ? sortedTags.findIndex(t => t.toLowerCase() === activeTagFilter.toLowerCase())
    : -1;
  const isExpanded = showAllTags || activeIdx >= MAX_VISIBLE_TAGS;

  const visibleTags = isExpanded ? sortedTags : sortedTags.slice(0, MAX_VISIBLE_TAGS);
  const hiddenCount = sortedTags.length - MAX_VISIBLE_TAGS;

  const pillsHtml = visibleTags.map(tag => {
    const isSelected = activeTagFilter && activeTagFilter.toLowerCase() === tag.toLowerCase();

    // WCAG AA (>= 4.5:1) high-contrast pills against dark navy background
    const pillClasses = isSelected
      ? "bg-[#3B82F6] hover:bg-blue-500 text-white border border-blue-300 font-semibold shadow-sm ring-2 ring-blue-400/40"
      : "bg-[#1E293B] hover:bg-slate-700 text-[#F8FAFC] border border-slate-600 hover:border-slate-400 font-medium";

    const checkIcon = isSelected
      ? `<svg class="w-3.5 h-3.5 text-white shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M16.704 5.29a1 1 0 010 1.42l-7.25 7.25a1 1 0 01-1.415 0l-3.25-3.25a1 1 0 011.414-1.42l2.543 2.544 6.543-6.544a1 1 0 011.415 0z" clip-rule="evenodd"/></svg>`
      : "";

    return `
      <button type="button"
              aria-pressed="${isSelected}"
              class="tag-filter-btn inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full font-mono text-xs transition cursor-pointer ${pillClasses}"
              data-tag="${tag}">
        ${checkIcon}
        <span>#${tag}</span>
      </button>
    `;
  }).join("");

  const toggleButtonHtml = hasMoreTags
    ? `<button type="button"
               id="toggleTagsBtn"
               aria-expanded="${isExpanded}"
               class="inline-flex items-center gap-1 px-3 py-1.5 rounded-full font-mono text-xs font-semibold bg-indigo-950/90 hover:bg-indigo-900 text-indigo-200 border border-indigo-400/40 transition cursor-pointer">
         ${isExpanded ? "&minus; Show less" : `+ Show all (${hiddenCount} more)`}
       </button>`
    : "";

  tagsContainer.innerHTML = `
    <span class="text-[#F8FAFC] font-medium mr-1">Popular Tags:</span>
    ${pillsHtml}
    ${toggleButtonHtml}
  `;

  tagsContainer.querySelectorAll(".tag-filter-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const selectedTag = e.currentTarget.getAttribute("data-tag");
      activeTagFilter = (activeTagFilter === selectedTag) ? null : selectedTag;
      populatePopularTags();
      applyFilters();
    });
  });

  const toggleBtn = document.getElementById("toggleTagsBtn");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      showAllTags = !isExpanded;
      populatePopularTags();
    });
  }
}

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
// 7. GLOBAL LIVE SEARCH & FILTER ENGINE
// ----------------------------------------------------------------------------
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

/**
 * Clears the search box, active tag pill, and category tab back to defaults.
 */
function resetAllFilters() {
  const searchInput = document.getElementById("globalSearchInput");
  if (searchInput) searchInput.value = "";

  activeTagFilter = null;
  activeCategoryFilter = "ALL";
  showAllTags = false;

  populatePopularTags();
  populateCategories();
  applyFilters();
}

// ----------------------------------------------------------------------------
// 8. MANUAL COMPLETION TRACKING & CROSS-DEVICE SHEETS SYNC
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

  // 1. Snapshot unlocked stamps BEFORE updating progress
  const prevStats = calculatePatronStats();
  const previouslyUnlockedIds = new Set(
    prevStats.badges.filter(b => b.unlocked).map(b => b.id)
  );

  // 2. Update reading progress in localStorage
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

  localStorage.setItem("polaris_reading_progress", JSON.stringify(progress));
  updateNavPatronHeader();

  // 3. Check if checking this chapter crossed a new stamp threshold
  if (isChecked) {
    const newStats = calculatePatronStats();
    const newlyUnlocked = newStats.badges.filter(
      b => b.unlocked && !previouslyUnlockedIds.has(b.id)
    );

    if (newlyUnlocked.length > 0) {
      // Pick the highest-tier stamp unlocked on this action
      const topStamp = newlyUnlocked[newlyUnlocked.length - 1];
      showStampToast(topStamp.title, topStamp.icon);
    }
  }

  // 4. Background sync to Google Sheets User_Progress
  const bookPages = libraryPages.filter(p => String(p.book_id || "").trim() === targetBookId);
  syncProgressToSheets(targetBookId, progress[targetBookId], bookPages.length);
}

/**
 * Updates completion state, syncs to Sheets, and refreshes the active reader UI immediately.
 */
function handleReaderCompletionToggle(pageId, bookId, isChecked) {
  togglePageCompletion(pageId, bookId, isChecked);
  viewPage(pageId, bookId, false); // false = don't jump scroll back to top
}

async function syncProgressToSheets(bookId, pagesReadArray, totalPages) {
  if (!currentUser || !currentUser.user_id) return;
  if (!WEB_APP_URL || WEB_APP_URL.includes("YOUR_DEPLOYED_WEB_APP_URL")) return;

  const syncIndicator = document.getElementById("syncStatusIndicator");
  if (syncIndicator) {
    syncIndicator.innerText = "↻ Syncing...";
    syncIndicator.className = "text-[11px] font-mono text-amber-600";
  }

  try {
    const response = await fetch(WEB_APP_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8"
      },
      body: JSON.stringify({
        user_id: currentUser.user_id,
        book_id: bookId,
        pages_read: pagesReadArray,
        total_pages: totalPages
      })
    });

    const resData = await response.json();
    if (resData.status === "success" && syncIndicator) {
      syncIndicator.innerText = "● Synced to Sheets";
      syncIndicator.className = "text-[11px] font-mono text-emerald-600";
    }
  } catch (err) {
    console.error("[Polaris Sync] Failed to write progress to Sheets:", err);
    if (syncIndicator) {
      syncIndicator.innerText = "⚠️ Offline (Saved Locally)";
      syncIndicator.className = "text-[11px] font-mono text-red-600";
    }
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

// ----------------------------------------------------------------------------
// 9. LIBRARY CARD DRAWER & DYNAMIC BADGE ENGINE
// ----------------------------------------------------------------------------
function calculatePatronStats() {
  const progress = getReadingProgress();
  let totalPagesRead = 0;
  let completedBooksCount = 0;

  const activeBooks = libraryBooks.filter(
    b => String(b.status || "ACTIVE").trim().toUpperCase() === "ACTIVE"
  );

  activeBooks.forEach(book => {
    const bId = String(book.book_id || "").trim();
    const bookPages = libraryPages.filter(p => String(p.book_id || "").trim() === bId);
    const readPages = (progress[bId] || []).filter(pid =>
      bookPages.some(bp => String(bp.page_id).trim() === String(pid).trim())
    );

    totalPagesRead += readPages.length;
    if (bookPages.length > 0 && readPages.length >= bookPages.length) {
      completedBooksCount += 1;
    }
  });

  let rankTitle = "New Patron";
  if (activeBooks.length > 0 && completedBooksCount >= activeBooks.length) {
    rankTitle = "Master Archivist";
  } else if (completedBooksCount >= 3) {
    rankTitle = "Subject Scholar";
  } else if (completedBooksCount >= 1) {
    rankTitle = "Avid Reader";
  } else if (totalPagesRead >= 1) {
    rankTitle = "Novice Reader";
  }

  const badges = [
    {
      id: "novice",
      icon: "📖",
      title: "Novice Reader",
      desc: "Complete at least 1 playbook page.",
      unlocked: totalPagesRead >= 1
    },
    {
      id: "avid",
      icon: "🏅",
      title: "Avid Reader",
      desc: "Complete 100% of any 1 playbook.",
      unlocked: completedBooksCount >= 1
    },
    {
      id: "scholar",
      icon: "🎓",
      title: "Subject Scholar",
      desc: "Complete 3 or more active playbooks.",
      unlocked: completedBooksCount >= 3
    },
    {
      id: "archivist",
      icon: "🏛️",
      title: "Master Archivist",
      desc: "Complete 100% of all active playbooks in the library.",
      unlocked: activeBooks.length > 0 && completedBooksCount >= activeBooks.length
    }
  ];

  const userRole = currentUser ? currentUser.role : "LEARNER";
  if (userRole === "CREATOR" || userRole === "ADMIN") {
    badges.push({
      id: "curator",
      icon: "✍️",
      title: userRole === "ADMIN" ? "Library Steward (Admin)" : "Playbook Author (Creator)",
      desc: "Authorized to publish and maintain enablement content.",
      unlocked: true
    });
  }

  return {
    totalPagesRead,
    completedBooksCount,
    totalActiveBooks: activeBooks.length,
    rankTitle,
    badges
  };
}

function openLibraryCard() {
  if (!currentUser) return;

  const stats = calculatePatronStats();

  document.getElementById("cardPatronName").innerText = currentUser.full_name;
  document.getElementById("cardPatronDept").innerText = `${currentUser.department} • ${formatRoleLabel(currentUser.role)}`;
  document.getElementById("cardPatronId").innerText = currentUser.user_id;
  document.getElementById("cardPatronEmail").innerText = currentUser.email;
  document.getElementById("cardPagesCount").innerText = stats.totalPagesRead;
  document.getElementById("cardBooksCount").innerText = `${stats.completedBooksCount}/${stats.totalActiveBooks}`;
  document.getElementById("cardTierLabel").innerText = stats.rankTitle;

  const badgesContainer = document.getElementById("badgesContainer");
  badgesContainer.innerHTML = stats.badges.map(b => {
    const cardStyle = b.unlocked
      ? "bg-emerald-50/70 border-emerald-200 text-polaris-text-heading"
      : "bg-slate-50 border-slate-200 text-[#475569]";
    const statusPill = b.unlocked
      ? `<span class="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">Unlocked</span>`
      : `<span class="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-slate-200/80 text-[#475569] border border-slate-300">Locked</span>`;

    return `
      <div class="p-3.5 rounded-xl border ${cardStyle} flex items-center justify-between gap-3 transition">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-lg shadow-2xs">
            ${b.unlocked ? b.icon : "🔒"}
          </div>
          <div>
            <h5 class="font-display text-xs font-bold text-polaris-text-heading">${b.title}</h5>
            <p class="text-[11px] text-[#475569] leading-snug mt-0.5">${b.desc}</p>
          </div>
        </div>
        ${statusPill}
      </div>
    `;
  }).join("");

  document.getElementById("libraryCardBackdrop").classList.remove("hidden");
  document.getElementById("libraryCardDrawer").classList.remove("hidden");
}

function closeLibraryCard() {
  document.getElementById("libraryCardBackdrop").classList.add("hidden");
  document.getElementById("libraryCardDrawer").classList.add("hidden");
}

/**
 * Fires a bottom-right toast notification when a patron unlocks a new stamp.
 * Clicking the toast opens the Patron Library Card drawer directly.
 */
function showStampToast(stampTitle, icon = "🏅") {
  // Remove any existing stamp toast so multiple unlocks don't overlap awkwardly
  const existingToast = document.getElementById("polarisStampToast");
  if (existingToast) existingToast.remove();

  const toast = document.createElement("div");
  toast.id = "polarisStampToast";
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");
  toast.className = [
    "fixed bottom-6 right-6 z-50 max-w-sm w-full sm:w-auto",
    "bg-slate-900 text-white border border-slate-700/80 rounded-xl shadow-2xl",
    "px-4 py-3.5 flex items-center gap-3.5 cursor-pointer",
    "transform transition-all duration-300 translate-y-4 opacity-0"
  ].join(" ");

  toast.innerHTML = `
    <div class="w-10 h-10 rounded-lg bg-amber-500/20 border border-amber-400/40 flex items-center justify-center text-xl shrink-0">
      ${icon}
    </div>
    <div class="pr-2">
      <p class="text-[10px] font-mono uppercase tracking-wider text-amber-400 font-bold">
        New Library Milestone
      </p>
      <p class="text-xs font-semibold text-white leading-snug mt-0.5">
        Stamp Unlocked: ${stampTitle} — Check your Patron Card
      </p>
    </div>
    <button type="button" aria-label="Dismiss notification" class="text-slate-400 hover:text-white text-sm font-bold pl-1 cursor-pointer">
      &times;
    </button>
  `;

  // Clicking the toast opens the Patron Library Card; clicking × just dismisses it
  toast.addEventListener("click", (e) => {
    if (e.target.closest("button")) {
      dismissToast();
      return;
    }
    dismissToast();
    openLibraryCard();
  });

  document.body.appendChild(toast);

  // Trigger slide-up entrance animation
  requestAnimationFrame(() => {
    toast.classList.remove("translate-y-4", "opacity-0");
    toast.classList.add("translate-y-0", "opacity-100");
  });

  // Auto-dismiss after 5 seconds
  const autoHideTimer = setTimeout(dismissToast, 5000);

  function dismissToast() {
    clearTimeout(autoHideTimer);
    toast.classList.remove("translate-y-0", "opacity-100");
    toast.classList.add("translate-y-4", "opacity-0");
    setTimeout(() => toast.remove(), 300);
  }
}

/**
 * Opens the "How It Works" serverless architecture modal.
 */
function openArchitectureModal() {
  const modal = document.getElementById("architectureModal");
  if (!modal) return;
  modal.classList.remove("hidden");
  document.body.classList.add("overflow-hidden");
}

/**
 * Closes the "How It Works" serverless architecture modal.
 */
function closeArchitectureModal() {
  const modal = document.getElementById("architectureModal");
  if (!modal) return;
  modal.classList.add("hidden");
  document.body.classList.remove("overflow-hidden");
}

// Allow closing with the Escape key
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeArchitectureModal();
  }
});


// ----------------------------------------------------------------------------
// 10. BOOKSHELF RENDERER
// ----------------------------------------------------------------------------
function renderBookshelf(books) {
  const grid = document.getElementById("bookGrid");
  const shelfCount = document.getElementById("shelfCount");
  const shelfControls = document.getElementById("shelfControls");
  const heroSection = document.querySelector(".hero-section");

  if (shelfControls) shelfControls.classList.remove("hidden");
  if (heroSection) heroSection.classList.remove("hidden");
  if (currentUser) applyRoleVisibility(currentUser.role);

  if (shelfCount) {
    shelfCount.innerText = `${books.length} Playbook${books.length === 1 ? "" : "s"} Available`;
  }

  if (!grid) return;

  grid.className = "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6";

  if (books.length === 0) {
    grid.innerHTML = `
      <div class="col-span-full py-16 px-6 text-center bg-white rounded-2xl border border-polaris-border-subtle shadow-elevation-1">
        <span class="text-3xl">🔍</span>
        <p class="font-display text-base font-semibold text-polaris-text-heading mt-2">No matching playbooks found</p>
        <p class="text-xs text-[#475569] mt-1 font-normal max-w-md mx-auto">
          Try adjusting your search keywords, switching categories, or clearing active tag filters.
        </p>
        <button type="button"
                onclick="resetAllFilters()"
                class="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-polaris-primary-container hover:bg-indigo-700 text-white shadow-sm transition cursor-pointer">
          <span>↺</span>
          <span>Reset Search &amp; Filters</span>
        </button>
      </div>`;
    return;
  }

  grid.innerHTML = books.map(book => {
    const currentBookId = String(book.book_id || "").trim();
    const bookPages = libraryPages
      .filter(p => String(p.book_id || "").trim() === currentBookId)
      .sort((a, b) => (Number(a.page_number) || 0) - (Number(b.page_number) || 0));

    const pageCount = bookPages.length;
    const firstPageId = pageCount > 0 ? String(bookPages[0].page_id).trim() : null;

    const stats = calculateBookProgress(currentBookId, pageCount);

    const rawBookStatus = (book.status || "ACTIVE").trim().toUpperCase();
    const isBookActive = rawBookStatus === "ACTIVE";

    // High-contrast Inactive status pill (#475569)
    const statusPill = isBookActive
      ? `<span class="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1 rounded-full"><span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Active</span>`
      : `<span class="inline-flex items-center gap-1.5 text-xs font-semibold text-[#475569] bg-slate-100 border border-slate-300 px-3 py-1 rounded-full"><span class="w-1.5 h-1.5 rounded-full bg-[#475569]"></span> Inactive</span>`;

    const progressLabelLeft = stats.isCompleted
      ? `<span class="inline-flex items-center gap-1 font-bold text-emerald-700">✓ Complete</span>`
      : `<span>Reading Progress</span>`;

    const progressLabelRight = stats.isCompleted
      ? `<span class="font-mono font-bold text-emerald-700">${pageCount} of ${pageCount} Pages (100%)</span>`
      : `<span class="font-mono text-polaris-text-heading font-semibold">${stats.readPages} of ${pageCount} Pages (${stats.percentage}%)</span>`;

    const barFillColor = stats.isCompleted ? "bg-emerald-500" : "bg-polaris-primary-container";
    const barTrackBorder = stats.isCompleted ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-polaris-progress-track";

    // High-contrast progress label row (#475569)
    const progressBlock = `
      <div class="mt-4 pt-3 border-t border-polaris-border-subtle">
        <div class="flex justify-between items-center text-xs text-[#475569] mb-1.5 font-medium">
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
      : "font-display font-semibold text-[#475569] text-lg leading-snug mb-2 cursor-not-allowed";

    // High-contrast disabled page button (#475569)
    const pageActionButton = isBookActive
      ? `<button type="button" ${actionClickAttr} class="inline-flex items-center gap-1.5 text-xs font-semibold text-polaris-primary-container bg-polaris-primary-light hover:bg-indigo-100 border border-indigo-200 px-3.5 py-1 rounded-full transition cursor-pointer">
           ${pageCount} ${pageCount === 1 ? "Page" : "Pages"} &rarr;
         </button>`
      : `<button type="button" disabled aria-disabled="true" class="inline-flex items-center gap-1.5 text-xs font-semibold text-[#475569] bg-slate-100 border border-slate-300 px-3.5 py-1 rounded-full cursor-not-allowed select-none">
           ${pageCount} ${pageCount === 1 ? "Page" : "Pages"} &rarr;
         </button>`;

    const cardBorderClasses = isBookActive
      ? "bg-polaris-card-bg border border-polaris-border-subtle rounded-xl p-6 hover:-translate-y-0.5 hover:shadow-elevation-2 transition-all duration-200 flex flex-col justify-between group"
      : "bg-slate-50/70 border border-slate-200/90 rounded-xl p-6 flex flex-col justify-between opacity-90";

    return `
      <div class="${cardBorderClasses}">
        <div>
          <div class="flex items-center justify-between mb-3">
            <span class="text-[10px] font-bold tracking-wider uppercase px-2 py-0.5 rounded-sm ${isBookActive ? 'bg-polaris-primary-light text-polaris-primary-container border border-indigo-100' : 'bg-slate-200/70 text-[#475569] border border-slate-300/60'} font-sans">
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
// 11. DEDICATED PAGE READER VIEW (BREADCRUMB + GROUPED FOOTER ACTIONS)
// ----------------------------------------------------------------------------
function renderMarkdownContent(rawMarkdown) {
  if (!rawMarkdown) {
    return '<p class="text-polaris-text-muted italic">No content available for this section.</p>';
  }

  let cleaned = String(rawMarkdown)
    .replace(/^```(?:markdown|md)?\s*\n?/i, "")
    .replace(/\n?```\s*$/g, "")
    .trim();

  cleaned = cleaned.replace(/^[ \t]+(?=#|>|-|\*|\d+\.)/gm, "");

  if (typeof marked !== "undefined") {
    marked.setOptions({
      breaks: true,
      gfm: true
    });
    return marked.parse(cleaned);
  }

  return cleaned;
}

function viewPage(pageId, bookId, shouldScrollTop = true) {
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
        ${isCurrent ? '<span>•</span>' : (isCompletedItem ? '<span class="text-emerald-600 font-bold">✓</span>' : '')}
      </button>
    `;
  }).join("");

  const isPageDone = (getReadingProgress()[activeBookId] || []).includes(cleanPageId);

  const rawStatus = (page.status || "PUBLISHED").toUpperCase();
  const statusBadge = rawStatus.includes("PENDING")
    ? `<span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300">⚠️ ${page.status}</span>`
    : `<span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-900 border border-emerald-300">✓ ${page.status}</span>`;

  let lastReviewed = page.last_reviewed_date || "N/A";
  let nextReview = page.next_review_due;

  if (!nextReview || nextReview === "N/A") {
    const baseDate = (lastReviewed !== "N/A" && !isNaN(new Date(lastReviewed).getTime()))
      ? new Date(lastReviewed)
      : new Date();
    baseDate.setDate(baseDate.getDate() + 90);
    nextReview = baseDate.toISOString().split("T")[0];
  }

  const pageTags = (page.tags || "").split(",").map(t => t.trim().replace(/^#/, "")).filter(Boolean);
  const tagsHtml = pageTags.length > 0
    ? `<div class="flex flex-wrap items-center gap-1.5">
         <span class="text-xs font-semibold text-slate-500 mr-1">Tags:</span>
         ${pageTags.map(t => `<span class="text-[11px] bg-slate-100 text-slate-600 px-2.5 py-0.5 rounded-full font-mono border border-slate-200">#${t}</span>`).join("")}
       </div>`
    : "";

  // Role-based Suggest Edit visibility (Creator & Admin only)
  const userRole = currentUser ? currentUser.role : "LEARNER";
  const canEdit = userRole === "CREATOR" || userRole === "ADMIN";
  const suggestEditHtml = canEdit
    ? `<a href="https://docs.google.com/forms" target="_blank" class="hover:text-polaris-primary-container font-medium inline-flex items-center gap-1">
         ✏️ Suggest Edit
       </a>`
    : "";

  // Next Chapter button (or Finish action on final chapter)
  const nextChapterButtonHtml = nextPage
    ? `<button type="button"
               onclick="viewPage('${String(nextPage.page_id).trim()}', '${activeBookId}')"
               class="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-polaris-primary-container hover:bg-indigo-700 text-white shadow-sm transition cursor-pointer">
         <span>Next Chapter</span>
         <span>&rarr;</span>
       </button>`
    : `<button type="button"
               onclick="exitReaderView()"
               class="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white shadow-sm transition cursor-pointer">
         <span>Finish &amp; Return to Bookshelf</span>
         <span>✓</span>
       </button>`;

  container.className = "block w-full";
  container.innerHTML = `
    <div class="max-w-7xl mx-auto w-full pt-2">
      
      <!-- Top Breadcrumb Trail -->
      <nav aria-label="Breadcrumb" class="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div class="flex flex-wrap items-center gap-2 text-xs text-[#475569]">
          <button type="button" onclick="exitReaderView()" class="font-semibold text-polaris-primary-container hover:underline cursor-pointer">
            Bookshelf
          </button>
          <span class="text-[#475569]">/</span>
          <span class="font-medium text-polaris-text-heading truncate max-w-xs sm:max-w-md">${bookTitle}</span>
          <span class="text-[#475569]">/</span>
          <span class="font-mono text-[#475569] font-medium">Chapter ${chapterNum}</span>
        </div>
        <div class="text-xs font-mono font-medium text-[#475569]">
          Page ${chapterNum} of ${pagesInBook.length}
        </div>
      </nav>

      <!-- Split Screen Layout -->
      <div class="grid grid-cols-1 md:grid-cols-12 items-stretch bg-white border border-polaris-border-subtle rounded-2xl shadow-elevation-1 min-h-[600px] overflow-hidden">
        
        <!-- Left Sidebar: Chapter Navigation (Top-edge aligned with Governance Header) -->
        <aside class="md:col-span-3 border-b md:border-b-0 md:border-r border-polaris-border-subtle p-6 sm:p-8 bg-slate-50/70">
          <div class="sticky top-24">
            <h4 class="font-display text-xs font-bold uppercase tracking-wider text-[#475569] mb-3 leading-none">
              Playbook Directory
            </h4>
            <div class="space-y-1.5">
              ${sidebarLinks}
            </div>
          </div>
        </aside>

        <!-- Right Pane: Main Article Content -->
        <article class="md:col-span-9 p-6 sm:p-8 space-y-6 flex flex-col justify-between">
          <div class="space-y-6">
            <!-- Document Control Governance Header -->
            <div class="bg-slate-50 border border-slate-200 rounded-xl p-5 text-xs text-polaris-text-body">
              <div class="flex items-center justify-between pb-3 border-b border-slate-200 mb-3">
                ${statusBadge}
                <span class="font-mono text-[11px] font-medium text-[#475569]">Chapter ${chapterNum} of ${pagesInBook.length}</span>
              </div>

              <!-- Governance Fields Matching Database -->
              <div class="grid grid-cols-3 gap-4 font-mono text-[11px]">
                <div>
                  <span class="block text-[#475569] font-sans uppercase text-[9px] font-bold">Version</span>
                  <span class="font-bold text-polaris-text-heading">${page.version || 'v1.0'}</span>
                </div>
                <div>
                  <span class="block text-[#475569] font-sans uppercase text-[9px] font-bold">Last Reviewed Date</span>
                  <span class="font-bold text-polaris-text-heading">${lastReviewed}</span>
                </div>
                <div>
                  <span class="block text-[#475569] font-sans uppercase text-[9px] font-bold">Next Review Date</span>
                  <span class="font-bold text-polaris-text-heading">${nextReview}</span>
                </div>
              </div>
            </div>

            <!-- Page Heading -->
            <div>
              <h1 class="font-display text-2xl sm:text-3xl font-extrabold text-polaris-text-heading tracking-tight mb-2">${page.title || 'Untitled Page'}</h1>
              <p class="text-[#475569] text-sm font-normal">Actionable guidelines and verified talk-tracks for frontline teams.</p>
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
          </div>

          <div class="space-y-6 pt-4">
            <!-- Utility Actions & Page Tags -->
            <div class="pt-6 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div class="flex items-center gap-4 text-xs text-[#475569]">
                <button type="button" onclick="navigator.clipboard.writeText(window.location.href); alert('Link copied!');" class="hover:text-polaris-primary-container font-medium cursor-pointer inline-flex items-center gap-1">
                  📋 Copy Link
                </button>
                <button type="button" onclick="window.print()" class="hover:text-polaris-primary-container font-medium cursor-pointer inline-flex items-center gap-1">
                  🖨️ Print / PDF
                </button>
                ${suggestEditHtml}
              </div>

              <div>
                ${tagsHtml}
              </div>
            </div>

            <!-- Bottom Return Navigation + Grouped Completion & Next Chapter Actions -->
            <div class="pt-6 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <button type="button" onclick="exitReaderView()" class="text-xs text-polaris-primary-container font-semibold hover:underline cursor-pointer self-start sm:self-auto">
                &larr; Back to Bookshelf
              </button>

              <!-- Side-by-side Grouped Footer Actions -->
              <div class="flex flex-wrap items-center gap-3 self-end sm:self-auto">
                <label class="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold border cursor-pointer transition select-none ${
                  isPageDone
                    ? "bg-emerald-50 border-emerald-300 text-emerald-800"
                    : "bg-slate-50 hover:bg-slate-100 border-slate-300 text-polaris-text-heading"
                }">
                  <input
                    type="checkbox"
                    ${isPageDone ? "checked" : ""}
                    class="w-4 h-4 accent-emerald-600 rounded cursor-pointer"
                    onchange="handleReaderCompletionToggle('${cleanPageId}', '${activeBookId}', this.checked)"
                  >
                  <span>${isPageDone ? "Completed" : "Mark as Completed"}</span>
                </label>

                ${nextChapterButtonHtml}
              </div>
            </div>
          </div>

        </article>
      </div>
    </div>
  `;

  if (shouldScrollTop) {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}

function exitReaderView() {
  const heroSection = document.querySelector(".hero-section");
  if (heroSection) heroSection.classList.remove("hidden");
  applyFilters();
}

// ----------------------------------------------------------------------------
// 12. GLOBAL EXPORTS
// ----------------------------------------------------------------------------
window.viewPage = viewPage;
window.exitReaderView = exitReaderView;
window.togglePageCompletion = togglePageCompletion;
window.handleReaderCompletionToggle = handleReaderCompletionToggle;
window.renderBookshelf = renderBookshelf;
window.openLibraryCard = openLibraryCard;
window.closeLibraryCard = closeLibraryCard;
window.logoutUser = logoutUser;
window.loginAsDemo = loginAsDemo;
window.resetAllFilters = resetAllFilters;
window.openArchitectureModal = openArchitectureModal;
window.closeArchitectureModal = closeArchitectureModal;