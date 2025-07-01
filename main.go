package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"html/template"
	"log"
	"net/http"
	"net/url"
	"strings"

	"github.com/PuerkitoBio/goquery"
	_ "github.com/mattn/go-sqlite3"
)

var tmpl *template.Template
var db *sql.DB

// Highlight represents a user-saved highlight or note in the database.
type Highlight struct {
	ID          string `json:"id"`
	Type        string `json:"type"`
	VerseID     string `json:"verseId"`
	Start       int    `json:"start"`
	End         int    `json:"end"`
	Note        string `json:"note,omitempty"`
	Translation string `json:"translation"`
	BookID      int    `json:"bookId"`
	Chapter     int    `json:"chapter"`
}

func main() {
	var err error
	db, err = sql.Open("sqlite3", "./bible_app.db")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	createTableSQL := `CREATE TABLE IF NOT EXISTS highlights (
		"id" TEXT NOT NULL PRIMARY KEY,
		"type" TEXT NOT NULL,
		"verseId" TEXT NOT NULL,
		"start" INTEGER NOT NULL,
		"end" INTEGER NOT NULL,
		"note" TEXT,
		"translation" TEXT NOT NULL,
		"bookId" INTEGER NOT NULL,
		"chapter" INTEGER NOT NULL
	);`

	_, err = db.Exec(createTableSQL)
	if err != nil {
		log.Fatalf("Error creating table: %q", err)
	}
	// Serve static files from the "static" directory
	fs := http.FileServer(http.Dir("static"))
	http.Handle("/static/", http.StripPrefix("/static/", fs))

	// Parse templates
	tmpl = template.Must(template.ParseGlob("templates/*.html"))

	// Handlers
	http.HandleFunc("/", indexHandler)
	http.HandleFunc("/api/highlights", highlightsHandler)
	http.HandleFunc("/api/highlights/delete/", deleteHighlightHandler)
	http.HandleFunc("/api/strongs_definition", strongsDefinitionHandler)

	// Start server
	fmt.Println("Server starting on port 8080...")
	if err := http.ListenAndServe(":8080", nil); err != nil {
		log.Fatal(err)
	}
}

func indexHandler(w http.ResponseWriter, r *http.Request) {
	err := tmpl.ExecuteTemplate(w, "index.html", nil)
	if err != nil {
		http.Error(w, "Failed to execute template", http.StatusInternalServerError)
		log.Println(err)
	}
}

func highlightsHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		getHighlightsHandler(w, r)
	case http.MethodPost:
		createHighlightHandler(w, r)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func getHighlightsHandler(w http.ResponseWriter, r *http.Request) {
	translation := r.URL.Query().Get("translation")
	bookIdStr := r.URL.Query().Get("bookId")
	chapterStr := r.URL.Query().Get("chapter")

	if translation == "" || bookIdStr == "" || chapterStr == "" {
		http.Error(w, "Missing required query parameters: translation, bookId, chapter", http.StatusBadRequest)
		return
	}

	query := `SELECT id, type, verseId, start, end, note, translation, bookId, chapter FROM highlights
	          WHERE translation = ? AND bookId = ? AND chapter = ?`

	rows, err := db.Query(query, translation, bookIdStr, chapterStr)
	if err != nil {
		http.Error(w, "Database query failed", http.StatusInternalServerError)
		log.Printf("DB Error: %v", err)
		return
	}
	defer rows.Close()

	highlights := []Highlight{}
	for rows.Next() {
		var h Highlight
		var note sql.NullString // Handle possible NULL values for note
		if err := rows.Scan(&h.ID, &h.Type, &h.VerseID, &h.Start, &h.End, &note, &h.Translation, &h.BookID, &h.Chapter); err != nil {
			http.Error(w, "Failed to scan row", http.StatusInternalServerError)
			log.Printf("DB Error: %v", err)
			return
		}
		if note.Valid {
			h.Note = note.String
		}
		highlights = append(highlights, h)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(highlights)
}

func createHighlightHandler(w http.ResponseWriter, r *http.Request) {
	var h Highlight
	if err := json.NewDecoder(r.Body).Decode(&h); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	query := `INSERT INTO highlights (id, type, verseId, start, end, note, translation, bookId, chapter)
	          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`

	stmt, err := db.Prepare(query)
	if err != nil {
		http.Error(w, "Failed to prepare statement", http.StatusInternalServerError)
		log.Printf("DB Error: %v", err)
		return
	}
	defer stmt.Close()

	var note sql.NullString
	if h.Note != "" {
		note = sql.NullString{String: h.Note, Valid: true}
	}

	_, err = stmt.Exec(h.ID, h.Type, h.VerseID, h.Start, h.End, note, h.Translation, h.BookID, h.Chapter)
	if err != nil {
		http.Error(w, "Failed to execute statement", http.StatusInternalServerError)
		log.Printf("DB Error: %v", err)
		return
	}

	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(h)
}

func deleteHighlightHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	id := strings.TrimPrefix(r.URL.Path, "/api/highlights/delete/")
	if id == "" {
		http.Error(w, "Missing highlight ID", http.StatusBadRequest)
		return
	}

	query := `DELETE FROM highlights WHERE id = ?`
	stmt, err := db.Prepare(query)
	if err != nil {
		http.Error(w, "Failed to prepare statement", http.StatusInternalServerError)
		log.Printf("DB Error: %v", err)
		return
	}
	defer stmt.Close()

	result, err := stmt.Exec(id)
	if err != nil {
		http.Error(w, "Failed to execute statement", http.StatusInternalServerError)
		log.Printf("DB Error: %v", err)
		return
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		http.Error(w, "Highlight not found", http.StatusNotFound)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// StrongsDefinition holds the scraped definition data.
type StrongsDefinition struct {
	StrongsNumber   string `json:"strongsNumber"`
	Lexeme          string `json:"lexeme"`
	Transliteration string `json:"transliteration"`
	Definition      string `json:"definition"`
}

// strongsDefinitionHandler scrapes Blue Letter Bible for a Strong's definition.
// It is brittle and depends on the HTML structure of blueletterbible.org.
func strongsDefinitionHandler(w http.ResponseWriter, r *http.Request) {
	// 1. Get query parameters
	word := r.URL.Query().Get("word")
	translation := r.URL.Query().Get("translation")
	bookName := r.URL.Query().Get("bookName")
	chapter := r.URL.Query().Get("chapter")
	verse := r.URL.Query().Get("verse")

	if word == "" || translation == "" || bookName == "" || chapter == "" || verse == "" {
		http.Error(w, "Missing required query parameters", http.StatusBadRequest)
		return
	}

	// 2. Construct the search URL for Blue Letter Bible's interlinear view
	verseRef := fmt.Sprintf("%s+%s:%s", bookName, chapter, verse)
	// Note: The 'Criteria' is the word we are looking for. 'fromverse' gives it context.
	searchURL := fmt.Sprintf("https://www.blueletterbible.org/search/preSearch.cfm?Criteria=%s&t=%s&ss=1&source=from_interlinear&fromverse=%s", url.QueryEscape(word), translation, url.QueryEscape(verseRef))

	// 3. Make the first request to get the interlinear page and find the Strong's link
	res, err := http.Get(searchURL)
	if err != nil {
		http.Error(w, "Failed to fetch from Blue Letter Bible", http.StatusInternalServerError)
		log.Printf("BLB request failed: %v for url %s", err, searchURL)
		return
	}
	defer res.Body.Close()

	if res.StatusCode != 200 {
		http.Error(w, fmt.Sprintf("Blue Letter Bible returned non-200 status: %d", res.StatusCode), http.StatusBadGateway)
		log.Printf("BLB status code: %d for URL: %s", res.StatusCode, searchURL)
		return
	}

	doc, err := goquery.NewDocumentFromReader(res.Body)
	if err != nil {
		http.Error(w, "Failed to parse BLB response", http.StatusInternalServerError)
		log.Printf("goquery parsing failed: %v", err)
		return
	}

	// 4. Find the link to the Strong's definition.
	var definitionURL string
	doc.Find("td.calque-processed").EachWithBreak(func(i int, s *goquery.Selection) bool {
		// Use Contains because the word might have punctuation (e.g., "men.")
		if strings.Contains(strings.ToLower(s.Text()), strings.ToLower(word)) {
			// Found the word, now find the Strong's link in the same row (parent tr).
			link, found := s.Parent().Find("td.strongs-num-unprocessed a").Attr("href")
			if found {
				definitionURL = "https://www.blueletterbible.org" + link
				return false // Stop iterating
			}
		}
		return true // Continue iterating
	})

	if definitionURL == "" {
		http.Error(w, "Could not find Strong's number link on Blue Letter Bible. The site's structure may have changed, or the word was not found in the interlinear view for that verse.", http.StatusNotFound)
		log.Printf("Could not find Strong's link for word '%s' at URL: %s", word, searchURL)
		return
	}

	// 5. Make the second request to the definition page
	defRes, err := http.Get(definitionURL)
	if err != nil {
		http.Error(w, "Failed to fetch definition page from BLB", http.StatusInternalServerError)
		log.Printf("BLB definition page request failed: %v", err)
		return
	}
	defer defRes.Body.Close()

	if defRes.StatusCode != 200 {
		http.Error(w, fmt.Sprintf("BLB definition page returned non-200 status: %d", defRes.StatusCode), http.StatusBadGateway)
		return
	}

	defDoc, err := goquery.NewDocumentFromReader(defRes.Body)
	if err != nil {
		http.Error(w, "Failed to parse BLB definition response", http.StatusInternalServerError)
		log.Printf("goquery definition parsing failed: %v", err)
		return
	}

	// 6. Scrape the definition details from the lexicon page.
	strongsNumber := defDoc.Find("#lexicon-head h1").Text()
	lexeme := defDoc.Find(".lex-lemma-head .lexeme").First().Text()
	transliteration := defDoc.Find(".lex-lemma-head .translit").First().Text()

	var definitionBuilder strings.Builder
	defDoc.Find("#lexDef p").Each(func(i int, s *goquery.Selection) {
		definitionBuilder.WriteString(s.Text())
		definitionBuilder.WriteString("\n\n") // Add paragraphs for readability
	})

	definition := strings.TrimSpace(definitionBuilder.String())
	if definition == "" {
		// Fallback for different structures (sometimes content is not in 'p' tags)
		definition = strings.TrimSpace(defDoc.Find("#lexDef").First().Text())
	}

	// 7. Send the response
	response := StrongsDefinition{
		StrongsNumber:   strings.TrimSpace(strongsNumber),
		Lexeme:          strings.TrimSpace(lexeme),
		Transliteration: strings.TrimSpace(transliteration),
		Definition:      definition,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}
