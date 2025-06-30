const express = require('express');
const bodyParser = require('body-parser');
const pool = require('./db'); // Import the database connection
const session = require('express-session'); // Import express-session for session management
const app = express();
const port = 3000;

app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// Configure session middleware
app.use(session({
    secret: 'your_secret_key',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // Set to true if using HTTPS
}));

// Render the signup page
app.get('/signup', (req, res) => {
    res.render('signup');
});

// Handle signup form submission
app.post('/signup', async (req, res) => {
    const { name, username, password } = req.body;
    try {
        await pool.query('INSERT INTO users (name, username, password) VALUES ($1, $2, $3)', [name, username, password]);
        res.redirect('/login'); // Redirect to login page after successful signup
    } catch (err) {
        console.error(err);
        res.status(500).send('Error occurred during signup');
    }
});

// Render the login page
app.get('/login', (req, res) => {
    res.render('login', { error: null });
});

// Handle login form submission
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM users WHERE username = $1 AND password = $2', [username, password]);
        if (result.rows.length > 0) {
            req.session.user = result.rows[0];
            res.redirect('/home');
        } else {
            res.render('login', { error: 'Invalid username or password' });
        }
    } catch (err) {
        console.error(err);
        res.status(500).send('Error occurred during login');
    }
});

// Render the home page
app.get('/home', async (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }
    try {
        const userId = req.session.user.user_id;
        const balanceResult = await pool.query('SELECT SUM(balance) AS balance FROM accounts WHERE user_id = $1', [userId]);
        const monthIncomeResult = await pool.query('SELECT SUM(amount) AS monthIncome FROM incomes WHERE user_id = $1 AND date_part(\'month\', income_date) = date_part(\'month\', CURRENT_DATE)', [userId]);
        const monthExpenseResult = await pool.query('SELECT SUM(amount) AS monthExpense FROM expenses WHERE user_id = $1 AND date_part(\'month\', expense_date) = date_part(\'month\', CURRENT_DATE)', [userId]);
        const transactionsResult = await pool.query('SELECT * FROM transactions WHERE account_id IN (SELECT account_id FROM accounts WHERE user_id = $1) ORDER BY time DESC', [userId]);
        const balance = balanceResult.rows[0].balance || 0;
        const monthIncome = monthIncomeResult.rows[0].monthincome || 0;
        const monthExpense = monthExpenseResult.rows[0].monthexpense || 0;
        const transactions = transactionsResult.rows;
        res.render('home', { 
            user: req.session.user, 
            balance, 
            monthIncome, 
            monthExpense, 
            transactions 
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error occurred while fetching home page data');
    }
});

// Render the accounts page
app.get('/accounts', async (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }
    try {
        const userId = req.session.user.user_id;
        const accountsResult = await pool.query(`
            SELECT a.account_type, a.balance, COALESCE(SUM(e.amount), 0) AS total_expenses
            FROM accounts a
            LEFT JOIN expenses e ON a.account_id = e.account_id
            WHERE a.user_id = $1
            GROUP BY a.account_type, a.balance
        `, [userId]);
        const accounts = accountsResult.rows;
        res.render('accounts', { accounts });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error occurred while fetching accounts data');
    }
});

// Handle create account form submission
app.post('/createAccount', async (req, res) => {
    const { accountType } = req.body;
    const userId = req.session.user.user_id;
    try {
        await pool.query('INSERT INTO accounts (user_id, account_type, balance, liabilities) VALUES ($1, $2, 0, 0)', [userId, accountType]);
        res.redirect('/accounts');
    } catch (err) {
        console.error(err);
        res.status(500).send('Error occurred while creating account');
    }
});

// Handle delete account form submission
app.post('/deleteAccount', async (req, res) => {
    const { deleteAccountType } = req.body;
    const userId = req.session.user.user_id;
    try {
        await pool.query('DELETE FROM accounts WHERE user_id = $1 AND account_type = $2', [userId, deleteAccountType]);
        res.redirect('/accounts');
    } catch (err) {
        console.error(err);
        res.status(500).send('Error occurred while deleting account');
    }
});

// Render the incomes page
app.get('/incomes', async (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }
    try {
        const userId = req.session.user.user_id;
        const accountsResult = await pool.query('SELECT account_id, account_type FROM accounts WHERE user_id = $1', [userId]);
        const accounts = accountsResult.rows;
        res.render('incomes', { accounts });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error occurred while fetching accounts data');
    }
});

// Handle add income form submission
app.post('/addIncome', async (req, res) => {
    const { incomeDate, accountType, incomeSource, amount } = req.body;
    const userId = req.session.user.user_id;
    try {
        await pool.query('INSERT INTO incomes (user_id, account_id, income_date, income_source, amount) VALUES ($1, $2, $3, $4, $5)', [userId, accountType, incomeDate, incomeSource, amount]);
        await pool.query('UPDATE accounts SET balance = balance + $1 WHERE account_id = $2', [amount, accountType]);
        res.redirect('/incomes');
    } catch (err) {
        console.error(err);
        res.status(500).send('Error occurred while adding income');
    }
});

// Render the expenses page
app.get('/expenses', async (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }
    try {
        const userId = req.session.user.user_id;
        const accountsResult = await pool.query('SELECT account_id, account_type FROM accounts WHERE user_id = $1', [userId]);
        const expensesResult = await pool.query(`
            SELECT e.expense_date, a.account_type, e.expense_category, e.amount, e.remark
            FROM expenses e
            JOIN accounts a ON e.account_id = a.account_id
            WHERE e.user_id = $1
            ORDER BY e.expense_date DESC
        `, [userId]);
        const accounts = accountsResult.rows;
        const expenses = expensesResult.rows;
        res.render('expenses', { accounts, expenses });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error occurred while fetching expenses data');
    }
});

// Handle add expense form submission
app.post('/addExpense', async (req, res) => {
    const { expenseDate, accountType, expenseCategory, amount, remark } = req.body;
    const userId = req.session.user.user_id;
    try {
        await pool.query('INSERT INTO expenses (user_id, account_id, expense_date, expense_category, amount, remark) VALUES ($1, $2, $3, $4, $5, $6)', [userId, accountType, expenseDate, expenseCategory, amount, remark]);
        await pool.query('UPDATE accounts SET balance = balance - $1 WHERE account_id = $2', [amount, accountType]);
        res.redirect('/expenses');
    } catch (err) {
        console.error(err);
        res.status(500).send('Error occurred while adding expense');
    }
});

// Render the budget page
app.get('/budget', async (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }
    try {
        const userId = req.session.user.user_id;
        const budgetsResult = await pool.query('SELECT * FROM budgets WHERE user_id = $1', [userId]);
        const expensesResult = await pool.query(`
            SELECT expense_category, SUM(amount) AS total_expenses
            FROM expenses
            WHERE user_id = $1
            GROUP BY expense_category
        `, [userId]);
        const budgets = budgetsResult.rows;
        const expenses = expensesResult.rows;
        const exceededBudgets = budgets.filter(budget => {
            const expense = expenses.find(exp => exp.expense_category === budget.expense_category);
            return expense && expense.total_expenses > budget.amount;
        });
        res.render('budget', { budgets, exceededBudgets });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error occurred while fetching budget data');
    }
});

// Handle allocate budget form submission
app.post('/allocateBudget', async (req, res) => {
    const { expenseCategory, budgetAmount } = req.body;
    const userId = req.session.user.user_id;
    try {
        await pool.query('INSERT INTO budgets (user_id, expense_category, amount) VALUES ($1, $2, $3)', [userId, expenseCategory, budgetAmount]);
        res.redirect('/budget');
    } catch (err) {
        console.error(err);
        res.status(500).send('Error occurred while allocating budget');
    }
});

// Handle remove budget form submission
app.post('/removeBudget', async (req, res) => {
    const { removeCategory } = req.body;
    const userId = req.session.user.user_id;
    try {
        await pool.query('DELETE FROM budgets WHERE user_id = $1 AND expense_category = $2', [userId, removeCategory]);
        res.redirect('/budget');
    } catch (err) {
        console.error(err);
        res.status(500).send('Error occurred while removing budget');
    }
});

// Handle remove all transactions
app.post('/removeAllTransactions', async (req, res) => {
    const userId = req.session.user.user_id;
    try {
        await pool.query('DELETE FROM transactions WHERE account_id IN (SELECT account_id FROM accounts WHERE user_id = $1)', [userId]);
        await pool.query('DELETE FROM incomes WHERE user_id = $1', [userId]);
        await pool.query('DELETE FROM expenses WHERE user_id = $1', [userId]);
        await pool.query('DELETE FROM budgets WHERE user_id = $1', [userId]);
        res.redirect('/home');
    } catch (err) {
        console.error(err);
        res.status(500).send('Error occurred while removing all transactions');
    }
});

// Handle logout
app.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            return res.status(500).send('Error occurred during logout');
        }
        res.redirect('/login');
    });
});

// Default route to handle root URL
app.get('/', (req, res) => {
    res.redirect('/signup'); // Redirect to signup page
});

app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});