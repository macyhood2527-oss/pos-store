# Inventory & POS System

A full-stack Inventory and Point of Sale system built using:

- Node.js
- Express.js
- MySQL
- REST APIs
- JWT Authentication (if implemented)

## Features

- Product management (CRUD)
- Stock-in / Stock-out tracking
- Sales recording
- Audit logs
- Role-based authentication (Admin / Cashier)
- Reports

## Database

Schema available in:
/sql/schema.sql

## Setup Instructions

1. Clone repo
2. Run npm install
3. Create .env using .env.example
4. Import sql/schema.sql into MySQL
5. Run npm start

## API Testing

This project includes a Postman collection for testing all endpoints.

Location: docs/postman_collection.json

Import into Postman to test authentication, products, stock-in, and sales routes.
