document.addEventListener("DOMContentLoaded", () => {
  // --- DOM Elements ---
  const bibleContent = document.getElementById("bible-content");
  const translationSelect = document.getElementById("translation-select");
  const themeToggle = document.getElementById("theme-toggle");
  const toggleNumbers = document.getElementById("toggle-numbers");
  const bookSelect = document.getElementById("book-select");
  const chapterSelect = document.getElementById("chapter-select");

  const noteModal = document.getElementById("note-modal");
  const wordModal = document.getElementById("word-modal");
  const noteTextarea = document.getElementById("note-textarea");
  const saveNoteBtn = document.getElementById("save-note");
  const highlightBtn = document.getElementById("highlight-text");

  // --- State ---
  let currentSelection = null;
  let currentState = {
    // The API uses numeric book IDs. John is book 43.
    bookId: 43,
    chapter: 1,
    translation: "NASB95",
    books: [], // To store the list of books for the current translation
  };

  // --- API Base URL ---
  const API_URL = "https://bolls.life";
  const BLB_URL = "https://www.blueletterbible.org";

  // --- Functions ---

  /**
   * Fetches and displays Bible text based on the current state.
   */
  async function loadBibleText() {
    const { translation, bookId, chapter } = currentState;

    bibleContent.innerHTML = "<p>Loading...</p>";

    try {
      // Use get-chapter endpoint, which may provide more structured data
      const response = await fetch(
        `${API_URL}/get-chapter/${translation}/${bookId}/${chapter}/`,
      );

      if (!response.ok) {
        let errorText = `API request failed: ${response.status} ${response.statusText}`;
        // Try to get more specific error from API response body
        try {
          const errorData = await response.json();
          if (errorData.detail) {
            errorText = errorData.detail;
          }
        } catch (e) {
          // Body was not JSON or empty, stick with the status text
        }
        throw new Error(errorText);
      }

      const verses = await response.json();

      if (Array.isArray(verses)) {
        renderBibleText(verses);
        reapplyAllHighlights(); // Re-apply after content is loaded.
      } else {
        throw new Error(
          "API response was not in the expected format (an array of verses).",
        );
      }
    } catch (error) {
      console.error("Failed to load Bible text:", error);
      bibleContent.innerHTML = `
                <p><strong>Error loading Bible text.</strong></p>
                <p>This may be because the selected translation ('${currentState.translation}') is not supported by the API.</p>
                <p>Commonly available free translations are KJV, YLT, and WEB.</p>
                <p><small>Details: ${error.message}</small></p>
            `;
    }
  }

  /**
   * Renders the fetched Bible text into the content area.
   * @param {Array} verses - The array of verse objects from the API.
   */
  function renderBibleText(verses) {
    const { bookId, chapter } = currentState;
    bibleContent.innerHTML = ""; // Clear previous content

    verses.forEach((verseData) => {
      const verseId = `verse-${bookId}-${chapter}-${verseData.verse}`;
      const p = document.createElement("p");
      p.id = verseId;
      p.className = "verse"; // Add a class for styling

      const verseNumSpan = document.createElement("span");
      verseNumSpan.className = "verse-number";
      verseNumSpan.textContent = `${verseData.verse}`;
      p.appendChild(verseNumSpan);

      const verseTextSpan = document.createElement("span");
      verseTextSpan.className = "verse-text";

      // Process the HTML from the API to make each word clickable
      const tempDiv = document.createElement("div");
      tempDiv.innerHTML = verseData.text;

      function processNode(node) {
        if (node.nodeType === 3) {
          // Text node
          const fragment = document.createDocumentFragment();
          // Split by space to identify words
          const words = node.textContent.split(/(\s+)/);
          words.forEach((word) => {
            if (word.trim().length > 0) {
              const span = document.createElement("span");
              span.className = "word";
              span.textContent = word;
              fragment.appendChild(span);
            } else {
              fragment.appendChild(document.createTextNode(word));
            }
          });
          return fragment;
        } else if (node.nodeType === 1) {
          // Element node
          const newNode = node.cloneNode(false);
          for (const child of Array.from(node.childNodes)) {
            newNode.appendChild(processNode(child));
          }
          return newNode;
        }
        return node.cloneNode(true);
      }

      for (const child of Array.from(tempDiv.childNodes)) {
        verseTextSpan.appendChild(processNode(child));
      }
      p.appendChild(verseTextSpan);

      bibleContent.appendChild(p);
    });
  }

  async function loadBooks() {
    currentState.translation = translationSelect.value.toUpperCase();
    bookSelect.disabled = true;
    chapterSelect.disabled = true;
    bookSelect.innerHTML = "<option>Loading books...</option>";

    try {
      const response = await fetch(
        `${API_URL}/get-books/${currentState.translation}/`,
      );
      if (!response.ok) {
        throw new Error(`API request failed: ${response.status}`);
      }
      const books = await response.json();
      currentState.books = books;

      bookSelect.innerHTML = "";
      books.forEach((book) => {
        const option = document.createElement("option");
        option.value = book.bookid;
        option.textContent = book.name;
        bookSelect.appendChild(option);
      });

      // Set book to John (43) or the first book if not found
      const defaultBookId = 43;
      const defaultBookExists = books.some((b) => b.bookid === defaultBookId);
      currentState.bookId = defaultBookExists ? defaultBookId : books[0].bookid;
      bookSelect.value = currentState.bookId;

      bookSelect.disabled = false;
      populateChapterSelect();
    } catch (error) {
      console.error("Failed to load books:", error);
      bookSelect.innerHTML = `<option>Error loading</option>`;
      bibleContent.innerHTML = `<p><strong>Could not load book list for ${currentState.translation}.</strong></p>`;
    }
  }

  function populateChapterSelect() {
    const selectedBook = currentState.books.find(
      (b) => b.bookid == bookSelect.value, // Use == for loose comparison as value is string
    );
    if (!selectedBook) return;

    chapterSelect.innerHTML = "";
    for (let i = 1; i <= selectedBook.chapters; i++) {
      const option = document.createElement("option");
      option.value = i;
      option.textContent = i;
      chapterSelect.appendChild(option);
    }

    currentState.bookId = selectedBook.bookid;
    currentState.chapter = 1;
    chapterSelect.value = 1;

    chapterSelect.disabled = false;
    loadBibleText();
  }

  /**
   * Toggles the theme between light and dark mode.
   */
  function toggleTheme() {
    document.body.classList.toggle("dark-mode");
    localStorage.setItem(
      "darkMode",
      document.body.classList.contains("dark-mode"),
    );
  }

  /**
   * Applies the saved theme from localStorage on page load.
   */
  function applySavedTheme() {
    if (localStorage.getItem("darkMode") === "true") {
      document.body.classList.add("dark-mode");
    }
  }

  /**
   * Toggles the visibility of verse numbers.
   */
  function toggleVerseNumbers() {
    document.body.classList.toggle(
      "hide-verse-numbers",
      !toggleNumbers.checked,
    );
  }

  /**
   * Handles text selection for notes and highlighting.
   */
  function handleTextSelection() {
    const selection = window.getSelection();
    if (selection.isCollapsed || selection.rangeCount === 0) return;

    if (
      bibleContent.contains(selection.anchorNode) &&
      bibleContent.contains(selection.focusNode)
    ) {
      currentSelection = selection.getRangeAt(0).cloneRange();
      noteModal.style.display = "flex";
    }
  }

  // --- Highlighting and Notes ---

  function getRangeLocation(range) {
    let p = range.startContainer;
    while (p && p.nodeName !== "P") {
      p = p.parentNode;
    }
    if (!p || !p.id.startsWith("verse-")) return null;

    const verseId = p.id;
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    let charCount = 0;
    let start = -1,
      end = -1;
    let node;

    while ((node = walker.nextNode())) {
      const nodeLength = node.textContent.length;
      if (start === -1 && node === range.startContainer) {
        start = charCount + range.startOffset;
      }
      if (end === -1 && node === range.endContainer) {
        end = charCount + range.endOffset;
        break;
      }
      charCount += nodeLength;
    }

    if (start !== -1 && end !== -1 && start < end) {
      return { verseId, start, end };
    }
    return null;
  }

  function applyHighlightFromLocation(location) {
    const p = document.getElementById(location.verseId);
    if (!p) return;

    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    let charCount = 0;
    let startNode = null,
      endNode = null;
    let startOffset = 0,
      endOffset = 0;
    let node;

    while ((node = walker.nextNode())) {
      const nodeLength = node.textContent.length;
      if (startNode === null && location.start < charCount + nodeLength) {
        startNode = node;
        startOffset = location.start - charCount;
      }
      if (endNode === null && location.end <= charCount + nodeLength) {
        endNode = node;
        endOffset = location.end - charCount;
        break;
      }
      charCount += nodeLength;
    }

    if (startNode && endNode) {
      const range = document.createRange();
      range.setStart(startNode, startOffset);
      range.setEnd(endNode, endOffset);

      if (location.type === "note") {
        // For notes, insert a symbol and wrap the text in a plain span for hover effects.
        const noteSymbol = document.createElement("span");
        noteSymbol.className = "note-symbol";
        noteSymbol.textContent = "📝";
        noteSymbol.dataset.highlightId = location.id;
        noteSymbol.dataset.note = location.note;

        const textSpan = document.createElement("span");
        textSpan.id = `note-text-${location.id}`;

        try {
          textSpan.appendChild(range.extractContents());
          range.insertNode(textSpan);
          // Insert the symbol right before the text it refers to
          textSpan.parentNode.insertBefore(noteSymbol, textSpan);
        } catch (e) {
          console.error("Failed to apply note from location", location, e);
        }
      } else {
        // For highlights, wrap in a styled span.
        const highlightSpan = document.createElement("span");
        highlightSpan.className = "highlight-only";
        highlightSpan.dataset.highlightId = location.id;

        try {
          // Using extractContents and insertNode is more robust than surroundContents
          highlightSpan.appendChild(range.extractContents());
          range.insertNode(highlightSpan);
        } catch (e) {
          console.error("Failed to apply highlight from location", location, e);
        }
      }
    }
  }

  async function reapplyAllHighlights() {
    const { translation, bookId, chapter } = currentState;
    const url = `/api/highlights?translation=${translation}&bookId=${bookId}&chapter=${chapter}`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch highlights: ${response.statusText}`);
      }
      const highlights = await response.json();
      if (highlights) {
        highlights.forEach(applyHighlightFromLocation);
      }
    } catch (error) {
      console.error("Could not load highlights:", error);
    }
  }

  /**
   * Shows a link to the Strong's concordance definition on Blue Letter Bible.
   * A direct API integration is not possible without a public API key from
   * Blue Letter Bible or a server-side component to handle web scraping.
   * This implementation constructs a search URL that takes the user directly
   * to the relevant information on the BLB website.
   * @param {HTMLElement} wordElement The clicked word span element.
   */
  async function showWordDefinition(wordElement) {
    const wordText = wordElement.textContent
      .trim()
      .replace(/[.,;:"'?!()]$/g, "");
    if (!wordText) return;

    const { translation } = currentState;

    document.getElementById("original-word").textContent =
      `Looking up "${wordText}"...`;
    document.getElementById("word-definition").innerHTML = "";
    wordModal.style.display = "flex";

    try {
      // Step 1: Find verse context from the element's parent
      const verseEl = wordElement.closest(".verse");
      if (!verseEl) {
        throw new Error("Could not identify the verse context for the word.");
      }
      const [_, bookId, chapter, verse] = verseEl.id.split("-");
      const book = currentState.books.find((b) => b.bookid == bookId);
      if (!book) {
        throw new Error(
          "Could not resolve book information from current state.",
        );
      }

      // Step 2: Construct a search URL for Blue Letter Bible.
      // This approach creates a URL to the interlinear view for the specific verse.
      // Note: BLB book names can be specific (e.g., 'Jhn' for John). The book name
      // from the bolls.life API might need mapping for best results.
      const bookAbbr = book.name.replace(/\s/g, "+"); // e.g. "1 Samuel" -> "1+Samuel"
      const verseRef = `${bookAbbr}+${chapter}:${verse}`;
      const searchUrl = `${BLB_URL}/search/preSearch.cfm?Criteria=${encodeURIComponent(wordText)}&t=${translation}&ss=1&source=from_interlinear&fromverse=${verseRef}`;

      // Step 3: Display a helpful message and a link in the modal.
      document.getElementById("original-word").textContent =
        `Definition for "${wordText}"`;
      document.getElementById("word-definition").innerHTML = `
        <p>To see the Strong's concordance information, please check Blue Letter Bible directly.</p>
        <p>A full integration requires a server-side component to bypass browser security (CORS) or a public API key for Blue Letter Bible, which is not currently available.</p>
        <p>
            <a href="${searchUrl}" target="_blank" rel="noopener noreferrer">
                Search for "${wordText}" in ${book.name} ${chapter}:${verse} on Blue Letter Bible
            </a>
        </p>
        <p style="word-break: break-all;"><small>URL: ${searchUrl}</small></p>
      `;
    } catch (error) {
      console.error("Failed to create link for word definition:", error);
      document.getElementById("original-word").textContent = "Error";
      document.getElementById("word-definition").textContent = error.message;
    }
  }

  async function addNewHighlight(type) {
    if (!currentSelection) return;

    const location = getRangeLocation(currentSelection);
    if (!location) {
      alert("Could not save highlight. The selection may be invalid or empty.");
      closeAllModals();
      return;
    }

    const { translation, bookId, chapter } = currentState;
    const newHighlight = {
      id: `h-${Date.now()}`,
      type: type,
      ...location,
      translation,
      bookId,
      chapter,
      note: "",
    };

    if (type === "note") {
      const noteText = noteTextarea.value.trim();
      if (!noteText) {
        alert("Please enter a note before saving.");
        return;
      }
      newHighlight.note = noteText;
    }

    try {
      const response = await fetch("/api/highlights", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(newHighlight),
      });

      if (!response.ok) {
        throw new Error(`Failed to save highlight: ${response.statusText}`);
      }

      applyHighlightFromLocation(newHighlight); // Apply to DOM immediately
      closeAllModals();
    } catch (error) {
      console.error("Could not save highlight:", error);
      alert("There was a problem saving your highlight. Please try again.");
    }
  }

  async function removeHighlight(id) {
    try {
      const response = await fetch(`/api/highlights/delete/${id}`, {
        method: "DELETE",
      });

      if (!response.ok && response.status !== 404) {
        throw new Error(`Failed to delete highlight: ${response.statusText}`);
      }

      // If API call is successful, remove from DOM
      const noteSymbol = document.querySelector(
        `.note-symbol[data-highlight-id="${id}"]`,
      );
      if (noteSymbol) {
        const textSpan = document.getElementById(`note-text-${id}`);
        if (textSpan) {
          const parent = textSpan.parentNode;
          while (textSpan.firstChild) {
            parent.insertBefore(textSpan.firstChild, textSpan);
          }
          parent.removeChild(textSpan);
        }
        noteSymbol.remove();
      } else {
        const highlightEl = document.querySelector(
          `.highlight-only[data-highlight-id="${id}"]`,
        );
        if (highlightEl) {
          const parent = highlightEl.parentNode;
          while (highlightEl.firstChild) {
            parent.insertBefore(highlightEl.firstChild, highlightEl);
          }
          parent.removeChild(highlightEl);
        }
      }
    } catch (error) {
      console.error("Could not remove highlight:", error);
      alert("There was a problem removing your highlight. Please try again.");
    }
  }

  function showActionMenu(element) {
    closeAllModals();

    const id = element.dataset.highlightId;
    const isNote = element.classList.contains("note-symbol");

    const menu = document.createElement("div");
    menu.id = "highlight-action-menu";
    menu.className = "modal-content";
    menu.style.position = "absolute";

    const rect = element.getBoundingClientRect();
    menu.style.top = `${window.scrollY + rect.bottom + 5}px`;
    menu.style.left = `${window.scrollX + rect.left}px`;
    menu.style.width = "auto";
    menu.style.maxWidth = "250px";
    menu.style.zIndex = "3000";

    if (isNote) {
      const note = element.dataset.note;
      const p = document.createElement("p");
      p.style.whiteSpace = "pre-wrap";
      p.style.marginTop = "0";
      p.innerHTML = `<strong>Note:</strong> ${note}`;
      menu.appendChild(p);
    }

    const buttonContainer = document.createElement("div");
    const removeBtn = document.createElement("button");
    removeBtn.textContent = isNote ? "Delete Note" : "Remove Highlight";
    removeBtn.onclick = () => {
      removeHighlight(id);
      closeAllModals();
    };

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "Close";
    closeBtn.style.marginLeft = "10px";
    closeBtn.onclick = closeAllModals;

    buttonContainer.appendChild(removeBtn);
    buttonContainer.appendChild(closeBtn);
    menu.appendChild(buttonContainer);

    document.body.appendChild(menu);
  }

  /**
   * Closes all open modals.
   */
  function closeAllModals() {
    document
      .querySelectorAll(".modal")
      .forEach((modal) => (modal.style.display = "none"));

    const actionMenu = document.getElementById("highlight-action-menu");
    if (actionMenu) {
      actionMenu.remove();
    }

    currentSelection = null;
    noteTextarea.value = "";
  }

  // --- Event Listeners ---

  themeToggle.addEventListener("click", toggleTheme);
  toggleNumbers.addEventListener("change", toggleVerseNumbers);
  translationSelect.addEventListener("change", loadBooks);

  bookSelect.addEventListener("change", () => {
    currentState.bookId = parseInt(bookSelect.value, 10);
    populateChapterSelect();
  });

  chapterSelect.addEventListener("change", () => {
    currentState.chapter = parseInt(chapterSelect.value, 10);
    loadBibleText();
  });

  bibleContent.addEventListener("mouseover", (e) => {
    if (e.target.classList.contains("note-symbol")) {
      const id = e.target.dataset.highlightId;
      const textSpan = document.getElementById(`note-text-${id}`);
      if (textSpan) {
        textSpan.classList.add("note-hover-highlight");
      }
    }
  });

  bibleContent.addEventListener("mouseout", (e) => {
    if (e.target.classList.contains("note-symbol")) {
      const id = e.target.dataset.highlightId;
      const textSpan = document.getElementById(`note-text-${id}`);
      if (textSpan) {
        textSpan.classList.remove("note-hover-highlight");
      }
    }
  });

  bibleContent.addEventListener("click", (e) => {
    // Word click should be first priority
    if (e.target.classList.contains("word")) {
      showWordDefinition(e.target); // Pass the element to get context
      return;
    }

    // Check for clicks on our custom elements
    const noteSymbol = e.target.closest(".note-symbol");
    if (noteSymbol) {
      e.stopPropagation();
      showActionMenu(noteSymbol);
      return;
    }
    const highlightEl = e.target.closest(".highlight-only");
    if (highlightEl) {
      e.stopPropagation();
      showActionMenu(highlightEl);
      return;
    }
  });

  bibleContent.addEventListener("mouseup", (e) => {
    // Avoid triggering selection when clicking on our custom elements
    if (
      e.target.closest(".note-symbol") ||
      e.target.closest(".highlight-only")
    ) {
      return;
    }
    handleTextSelection();
  });

  // Modal functionality
  highlightBtn.addEventListener("click", () =>
    addNewHighlight("highlight-only"),
  );
  saveNoteBtn.addEventListener("click", () => addNewHighlight("note"));

  document.querySelectorAll(".close-button").forEach((btn) => {
    btn.addEventListener("click", closeAllModals);
  });

  window.addEventListener("click", (e) => {
    if (e.target.classList.contains("modal")) {
      closeAllModals();
    }
  });

  // --- Initialization ---
  applySavedTheme();
  toggleVerseNumbers();
  loadBooks();
});
