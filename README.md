# Screen Share Application

A real-time screen sharing application that allows users to create rooms and share their screens with others.

## Features

- Create a room and share your screen
- Join existing rooms using a room ID
- Real-time screen sharing with audio
- Modern and responsive UI
- Easy to use interface

## Prerequisites

- Node.js >= 18.0.0
- npm >= 8.0.0

## Setup

1. Clone the repository:
```bash
git clone <repository-url>
cd screenplay
```

2. Install backend dependencies:
```bash
cd backend
npm install
```

3. Install frontend dependencies:
```bash
cd ../frontend
npm install
```

## Running the Application

1. Start the backend server:
```bash
cd backend
npm start
```

2. In a new terminal, start the frontend development server:
```bash
cd frontend
npm start
```

3. Open your browser and navigate to `http://localhost:3000`

## Usage

1. To share your screen:
   - Click "Create New Room"
   - Allow screen sharing when prompted
   - Share the room ID with others

2. To view someone's screen:
   - Enter the room ID in the input field
   - Click "Join Room"

## Technologies Used

- Frontend:
  - React
  - TypeScript
  - Material-UI
  - Socket.IO Client

- Backend:
  - Node.js
  - Express
  - Socket.IO
  - CORS 