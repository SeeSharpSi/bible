package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"html/template"
	"log"
	"net/http"
	"strings"

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
