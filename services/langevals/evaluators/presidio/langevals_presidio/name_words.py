"""Name words the frequency rule misreads, kept so a capitalised name is not refused.

The frequency rule in allcaps_names reads a word as a name when the model's
corpus writes it mostly in Titlecase. Short names from several traditions are
written there mostly as something else: Ngo and Seo as acronyms (NGO, SEO),
Hung, Song and Tan as everyday words. Without this list HUNG NGO, WOO SEO and
CEM TAN stay in clear while Hung Ngo is redacted.

The words are common surnames and given-name syllables, in lowercase ASCII
with diacritics removed, as they are written in romanised text. English stop
words are not honoured even if listed. Many entries are also English words
(Long, Song, Tan), so a listed word only counts beside other listed or unseen
words (see allcaps_names.normalisation_justifies_span).
"""

_CHINESE = """
an ang bai bao bei bin bing bo cai cao chang chao chen cheng cheung chi chia
chien chin ching chiu chong chou chow chu chua chuan chun chung cui dai dan
deng di ding dong du duan fan fang fei feng foo fu fung gang gao ge geng goh
gong gu guan guo hai han hao he heng ho hong hou hu hua huan huang hui huo ji
jia jian jiang jiao jie jin jing jun kai kang khoo koh kong kuan kwan kwok lai
lam lan lang lau lee lei leong leung li lian liang liao lim lin ling liu loh
long lou low lu luo lv ma mai mak man mao mei meng miao min ming mo mu na ng
ngai ni ning niu ong ouyang pan pang pei peng ping qi qian qiang qin qing qiu
quan quek rong ruan rui seah shan shao shen sheng shi shu si sim siu song su
sun tai tan tang tao tay teo teoh tian ting toh tong tse tsui wan wang wei wen
wong woo wu xia xian xiang xiao xie xin xing xiong xiu xu xuan xue yan yang yao
ye yeo yeung yi yin ying yip yong you yu yuan yue yun zeng zhan zhang zhao
zheng zhong zhou zhu zhuang zi zou
"""

_KOREAN = """
ahn ah bae baek bang bin byun cha chae cheon cho choi chul chun chung do dong
eun gi gil gyu ha han heo hoon hwa hwang hye hyo hyun hee ho hong jae jang jeon
jeong ji jin jo joo joon jun jung kang kim ko koo kwak kwon kyung lee lim min
mi moon myung na nam noh oh park ryu sang seo seok seong seung shin shim so soo
son song suk sun sung tae uhm um won woo yang ye yeon yeong yong yoo yoon young
yu yun
"""

_VIETNAMESE = """
anh bao bich binh bui chau chi cuong dang danh dao dat diem dinh do doan duc
dung duong duy giang ha hai han hang hanh hao hien hieu hoa hoai hoang hong hue
hung huong huy huyen huynh khang khanh khoa khoi kieu kim lam lan le lien linh
loan loc long luu ly mai manh minh my nam nga ngan nghia ngo ngoc nguyen nhan
nhi nhung oanh phan phat phong phuc phung phuong quan quang quoc quy quynh sang
son tam tan thach thai thang thanh thao thi thinh tho thu thuy tien tin toan
trai tran trang tri trinh trong truc trung truong tu tuan tung tuyet uyen van
viet vinh vo vu vuong vy xuan yen
"""

_JAPANESE = """
abe aoi chiba emi endo goto hara hayashi hiro ikeda ishii ito ken kenta kei
kondo mai mao mori nana noda oda ogawa oka ono rei ren rin saito sakai sato
sora sota taro ueda ueno yu yui yuki yuko yuna
"""

_TURKISH = """
acar ak akin aksoy aktas alp altin arda arslan ata avci ay aydin ayse baris
berk bulut can cansu celik cem cetin coskun demir deniz dogan ece efe ege elif
emre er eren erdem gul gunes ilke ipek irem kaan kara kaya kilic koc korkmaz
kurt mehmet mert nur onur oya oz ozan ozdemir ozturk polat sahin sen sena
sevgi simsek tan tekin tuna umut uysal yavuz yildiz yilmaz
"""

_ARABIC = """
abbas adel ahmed ali amal amin amir amr anas aziz bakr basil bilal dina fadi
farah fares faris hadi hadid haddad hajj hamad hamid hani hassan hiba huda
imad issa jamal karim khalid khan layla lina mahmoud malik mansour mona nabil
nader najjar nasser nour noor omar rami rana reem saad sabbagh said saleh salma
sami samir sara tarek walid yasin yousef yusuf zaid zain zainab
"""

_WEST_AFRICAN = """
abubakar ade adebayo adeyemi ado ama amaka ayo balogun bayo bello bola chidi
chika dayo eze ezra femi funmi ibrahim ife kemi kofi kwame kwesi mensah musa
ngozi nkem nwosu obi oduya ojo okafor okeke okon okoro ola olu segun tolu tunde
uche yaw yusuf
"""

_SOUTH_ASIAN = """
amit anil arjun asha bose das deep desai dev gita gupta iyer jain joshi kiran
kumar maya mehta mishra mohan nair neha patel prem priya raj ram rani rao ravi
reddy sharma shah shiva singh sita usha verma
"""

NAME_WORDS = frozenset(
    word
    for tradition in (
        _CHINESE,
        _KOREAN,
        _VIETNAMESE,
        _JAPANESE,
        _TURKISH,
        _ARABIC,
        _WEST_AFRICAN,
        _SOUTH_ASIAN,
    )
    for word in tradition.split()
)
