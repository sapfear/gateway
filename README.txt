1. Настройка скпритов.
 - скрипт client_modbus.js (перекачивалка данных из модбас в базу)
 переменная debug (16 строка) управляет, включить ли обращение в модбас устройство по адресу debug_addr или ожидать udp пакета.
 переменная mongo_url - адрес базы данных и ее название. ("mongodb://localhost:27017/" + "test_2")
 REGISTER_READ_OFFSET - смещение для чтения регистров (по умолчанию с 0)
 REGISTER_WRITE_OFFSET - смещение записи регистров
 в режиме debug = true чтение идет из Holding регистров. строка 197 управляет выборов функции чтения.
 
 - скрипт client_ocpp.js (скрипт запуска ocpp клиента)
 server_url = 'http://localhost:9000/' - адрес OCPP сервера + порт
 identifier - название точки заряда
 
 - скрипт plugin/cp.js (основной скрипт клиента)
 переменная self.mongo_url - адрес базы данных и ее название. ("mongodb://localhost:27017/" + "test_2")
 
 - скрипт db_check.js (монитор базы данных, при запуске показывает текущеее содержимое бд и завершает работу)
 url = "mongodb://localhost:27017/test_2"; - адрес базы данных и ее название. 
 
 - скрипт sim.js - симулятор сервера OCPP, настройки не требует.
 
2. Запуск скриптов
	Все скрипты запускаются командой. Окно консоли с запущенной командой оставить открытым.
	node <script_name>.js
	
	node client_ocpp.js
	node client_modbus.js
	node db_check.js
	node sim.js - предложит запуск симулятора. запуск зарядной точки осуществляется командой start_cs 9000 (переменная - порт)
	
	
3. Тестирование
	Для работы скриптов нужна запущенная БД (обычно командой "mongod"). При отсутсвии работающей базы скрипты входят в цикл ожидания соединения с ней. 
	В этом режиме client_ocpp будет отвечать Rejected на команды центральной системы.
	
	Для тестирования модбаса локально есть файл настройки test.ananas для заполнения регистров в симуляторе Ananas.
	
	Для запуска команд со стороны центральной системы нужно ввести в окно sim.js команду в формате
	remote_<команда>
	
	remote_unlockconnector
	remote_changeavailability
	remote_clearcache
	remote_starttransaction
	remote_stoptransaction
	remote_cancelreservation
	remote_datatransfer
	remote_getconfiguration
	remote_getlocallistversion
	remote_reservenow
	remote_sendlocallist
	
	команды отправляются с предзаполненными полями.
	
	