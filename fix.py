content = open('app.py', 'r', encoding='utf-8').read()
content = content.replace('from datetime import datetime', 'from datetime import datetime, timedelta')
content = content.replace(
    'arama = requests.utils.quote(f"{sembol_kisa} {sirket_adi} hisse")',
    'yedi_gun_once = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")\n        arama = requests.utils.quote(f"{sembol_kisa} {sirket_adi} hisse after:{yedi_gun_once}")'
)
open('app.py', 'w', encoding='utf-8').write(content)
print('Tamam!')