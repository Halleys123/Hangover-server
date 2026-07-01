# Hangover Server

The backend API for **Hardware Prototyping Copilot**, built with Express, TypeScript, and MongoDB/Mongoose. It manages project canvas states, user authentication, hardware component catalogs, and datasheet uploads.

---

## Features

- **Authentication**: Secure registration, login, JWT-based authentication middleware, and demo account access.
- **Project & Canvas Editor**: Complete CRUD operations for workspace projects, SvelteFlow canvas nodes/edges state persistence, and auto-extraction of unique component labels.
- **Component Library**: Manage a pre-populated catalog of microcontrollers and sensors, plus user-specific personal component libraries.
- **Datasheet Management**: File upload integration using `multer` for parsing and importing hardware schematics and specifications.
- **Database Seeding**: Built-in script to pre-populate standard components and sample projects.

---

## Directory Structure

```
server/
├── src/
│   ├── data/        # Static catalog data and seed helpers
│   ├── middleware/  # JWT validation and error handlers
│   ├── models/      # Mongoose schemas (User, Project, Component, Datasheet)
│   ├── routes/      # Express API routers (auth, projects, components, datasheets)
│   ├── scripts/     # Database seeding scripts (seed.ts)
│   ├── services/    # Cognee and vector parsing integrations
│   ├── types/       # TypeScript type declarations
│   └── index.ts     # Main application bootstrap
├── dist/            # Compiled JavaScript output
├── example.env      # Example template for environmental variables
├── tsconfig.json    # TypeScript compiler configuration
└── package.json     # Node script commands and dependencies
```

---

## Getting Started

### Prerequisites
- **Node.js** (v18 or higher recommended)
- **MongoDB** (Running locally or a Mongo Atlas connection string)

### Installation
1. Install server dependencies:
   ```bash
   npm install
   ```

2. Copy the environment variables template and configure it:
   ```bash
   cp example.env .env
   ```
   Modify the `.env` file to match your environment settings:
   - `MONGODB_URI`: Your MongoDB database connection string.
   - `JWT_SECRET`: Secret key used for signing JSON Web Tokens.
   - `PORT`: Server port (defaults to `3000`).
   - `CLIENT_ORIGIN`: Allowed CORS origin (defaults to client dev URL `http://localhost:5173`).

### Seeding the Database
Pre-populate the database with the core catalog (microcontrollers, sensors) and sample projects:
```bash
npm run seed
```

### Running the Server

#### Development Mode
Runs the application with hot-reloading using `tsx watch`:
```bash
npm run dev
```

#### Production Mode
Compile the TypeScript code and run the compiled JavaScript from the `dist/` directory:
```bash
npm run build
npm start
```

---

## API Endpoints Reference

All endpoints are prefixed with `/api`.

### 1. Authentication (`/api/auth`)
*   `POST /register` - Register a new user account.
*   `POST /login` - Log in to an account and receive a JWT.

### 2. Projects (`/api/projects`)
*   `GET /` - Fetch all projects for the authenticated user.
*   `GET /:id` - Fetch details for a specific project.
*   `POST /` - Create a new project.
*   `PUT /:id` - Update project details (name, description, status).
*   `PUT /:id/canvas` - Save canvas nodes and edges (automatically parses and updates the `components` list based on active components).
*   `DELETE /:id` - Permanently delete a project.

### 3. Components (`/api/components`)
*   `GET /` - Fetch user's personal components library.
*   `GET /catalog` - Fetch the global pre-seeded components catalog.
*   `POST /` - Add a component to the user's library.

### 4. Datasheets (`/api/datasheets`)
*   `GET /` - Fetch list of uploaded datasheets.
*   `POST /` - Upload a new datasheet PDF (triggers vector indexing placeholder pipeline).
