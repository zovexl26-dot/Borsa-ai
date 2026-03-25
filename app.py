import os
from flask import Flask, render_template, request, jsonify, redirect, url_for, flash
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager, UserMixin, login_user, login_required, logout_user, current_user
from werkzeug.security import generate_password_hash, check_password_hash
import yfinance as yf
import pandas as pd
import pandas_ta as ta
from openai import OpenAI
from datetime import datetime

app = Flask(__name__)

# --- GÜVENLİK VE VERİTABANI AYARLARI ---
# Railway'de sorun yaşamamak için SECRET_KEY'i sabitliyoruz
app.config['SECRET_KEY'] = 'borsa-ai-ozel-anahtar-987654'
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///users.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)
login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = 'login' # Giriş yapmamış olanları buraya yönlendirir

# --- KULLANICI MODELİ (Veritabanı Tablosu) ---
class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password = db.Column(db.String(120), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))

# --- AI VE VERİ AYARLARI ---
client = OpenAI(
    api_key=os.getenv("DEEPSEEK_API_KEY"),
    base_url="https://api.deepseek.com"
)

def get_stock_data(ticker):
    try:
        if not ticker.endswith(".IS"):
            ticker = ticker + ".IS"
        stock = yf.Ticker(ticker)
        hist = stock.history(period="1mo")
        if hist.empty:
            return None, None
        
        # Teknik Göstergeler (Eski kodundaki mantık)
        hist['RSI'] = ta.rsi(hist['Close'], length=14)
        macd = ta.macd(hist['Close'])
        hist = pd.concat([hist, macd], axis=1)
        hist['SMA_20'] = ta.sma(hist['Close'], length=20)
        
        info = stock.info
        return hist, info
    except Exception as e:
        print(f"Veri çekme hatası: {e}")
        return None, None

# --- ROTARLAR (SAYFALAR) ---

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        
        # Kullanıcı var mı kontrol et
        user_exists = User.query.filter_by(username=username).first()
        if user_exists:
            flash('Bu kullanıcı adı zaten alınmış!', 'danger')
            return redirect(url_for('register'))
            
        hashed_password = generate_password_hash(password, method='pbkdf2:sha256')
        new_user = User(username=username, password=hashed_password)
        db.session.add(new_user)
        db.session.commit()
        
        flash('Başarıyla kayıt oldunuz! Şimdi giriş yapabilirsiniz.', 'success')
        return redirect(url_for('login'))
    return render_template('register.html')

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        user = User.query.filter_by(username=username).first()
        
        if user and check_password_hash(user.password, password):
            login_user(user)
            return redirect(url_for('index'))
        else:
            flash('Giriş başarısız. Lütfen bilgilerinizi kontrol edin.', 'danger')
            
    return render_template('login.html')

@app.route('/logout')
@login_required
def logout():
    logout_user()
    return redirect(url_for('index'))

@app.route('/analyze', methods=['POST'])
@login_required # Sadece giriş yapan üyeler analiz yapabilsin
def analyze():
    ticker = request.form.get('ticker').upper()
    hist, info = get_stock_data(ticker)
    
    if hist is None:
        return render_template('index.html', error="Hisse sembolü bulunamadı (Örn: THYAO)")

    last_price = hist['Close'].iloc[-1]
    rsi = hist['RSI'].iloc[-1]
    
    # AI Analiz Promptu
    prompt = f"""
    Hisse: {ticker}
    Son Fiyat: {last_price:.2f}
    RSI: {rsi:.2f}
    Şirket Özeti: {info.get('longBusinessSummary', 'Bilgi yok')[:500]}
    
    Lütfen bu verileri analiz et ve yatırımcı için kısa, öz bir tavsiye ver.
    """
    
    try:
        response = client.chat.completions.create(
            model="deepseek-chat",
            messages=[
                {"role": "system", "content": "Sen profesyonel bir borsa analistisin."},
                {"role": "user", "content": prompt},
            ],
            stream=False
        )
        analysis_text = response.choices[0].message.content
    except Exception as e:
        analysis_text = f"AI Analizi şu an yapılamıyor: {str(e)}"

    return render_template('analysis.html', 
                           ticker=ticker, 
                           info=info, 
                           analysis=analysis_text,
                           price=round(last_price, 2))

# --- VERİTABANINI OLUŞTURMA ---
if __name__ == '__main__':
    with app.app_context():
        db.create_all() # Bu komut users.db dosyasını otomatik oluşturur
    app.run(debug=True)