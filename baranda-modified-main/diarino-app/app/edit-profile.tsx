import { useEffect, useState } from "react";
import { router } from "expo-router";
import { View, Text, Pressable, ScrollView, StyleSheet, Alert, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import Svg, { Path, Circle } from "react-native-svg";
import * as ImagePicker from "expo-image-picker";
import { useLanguage } from "../lib/hooks/useLanguage";
import { useThemeColors, ThemeColors } from "../lib/hooks/useThemeColors";
import { useCurrentUser } from "../lib/hooks/useCurrentUser";
import { useProfile } from "../lib/hooks/useProfile";
import { useLogMedia } from "../lib/hooks/useMedia";
import { uploadToCloudinary, cldOptimized } from "../lib/cloudinary";
import { FormLabel, FormInput, ChipRow } from "../components/publish/FormControls";
import { ProvinceAutocomplete } from "../components/publish/ProvinceAutocomplete";
import { PhoneInput, PhoneInputValue } from "../components/shared/PhoneInput";
import { validateAndFormatPhone } from "../lib/phone";
import { findCountry } from "../lib/countries";
import { CountryPickerModal } from "../components/shared/CountryPickerModal";
import { COUNTRIES } from "../lib/countries";
import { logAndGetSafeMessage } from "../lib/errors";
import { signOut } from "../lib/hooks/useAuth";

// ↔ بند 4 — شاشة "تعديل بيانات الحساب" الجديدة. توصل من:
//   • شاشة الإعدادات (قسم البروفايل فوق زر تسجيل الخروج مباشرة)
// صورة البروفايل وبقية الحقول كلها بتتقرأ/تتحفظ فى نفس صف public.profiles
// (عبر useProfile — مصدر واحد، مفيش نسخة تانية من الصورة أو البيانات).
export default function EditProfileScreen() {
  const { t, language } = useLanguage();
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);
  const { user, loading: userLoading } = useCurrentUser();
  const { profile, isLoading, update } = useProfile();
  const logMedia = useLogMedia();

  useEffect(() => {
    if (userLoading) return;
    if (!user || user.is_anonymous) {
      signOut().finally(() => router.replace("/"));
    }
  }, [user, userLoading]);

  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [birthDate, setBirthDate] = useState(""); // YYYY-MM-DD
  const [gender, setGender] = useState<"male" | "female" | "">("");
  const [nationalityCode, setNationalityCode] = useState("");
  const [nationalityPickerVisible, setNationalityPickerVisible] = useState(false);
  const [residence, setResidence] = useState("");
  const [phone, setPhone] = useState<PhoneInputValue>({ countryIso2: "", localNumber: "" });
  const [saving, setSaving] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // نعمّر الحقول من البروفايل أول ما يوصل، مرة واحدة بس (عشان لو المستخدم
  // بدأ يكتب مش نرجّع نعيد الكتابة فوق تعديلاته لما الكاش يعمل refetch).
  useEffect(() => {
    if (hydrated || !profile) return;
    setAvatarUri(profile.avatarUrl);
    setUsername(profile.username ?? "");
    setFirstName(profile.firstName ?? "");
    setLastName(profile.lastName ?? "");
    setBirthDate(profile.birthDate ?? "");
    setGender(profile.gender ?? "");
    setNationalityCode(profile.nationality ?? "");
    setResidence(profile.residence ?? "");
    setPhone({
      countryIso2: profile.phoneCountryCode ? (findCountry(profile.phoneCountryCode)?.code ?? "") : "",
      localNumber: profile.phoneE164 ?? "",
    });
    setHydrated(true);
  }, [profile, hydrated]);

  const nationalityCountry = COUNTRIES.find((c) => c.code === nationalityCode);

  async function pickAvatar() {
    if (!user?.id) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled) return;
    const uri = result.assets[0].uri;
    try {
      const uploadResult = await uploadToCloudinary(uri, "image");
      logMedia.mutate({ ownerId: user.id, type: "image", context: "avatar", result: uploadResult });
      setAvatarUri(uploadResult.url);
      await update.mutateAsync({ avatarUrl: uploadResult.url });
    } catch {
      Alert.alert(t("تعذر رفع الصورة"), t("حاول مرة أخرى."));
    }
  }

  async function handleSave() {
    if (!user || user.is_anonymous) {
      Alert.alert(t("تسجيل الدخول مطلوب"), t("سجّل الدخول أولاً لتعديل بيانات حسابك."));
      await signOut();
      router.replace("/");
      return;
    }
    let phonePatch: Partial<{ phoneE164: string; phoneCountryCode: string; phoneCountryName: string }> = {};
    if (phone.localNumber.trim()) {
      const country = findCountry(phone.countryIso2);
      const result = validateAndFormatPhone(phone.localNumber, phone.countryIso2);
      if (!result.valid) {
        Alert.alert(t("رقم الهاتف غير صحيح"), t("تأكد من كتابة رقم الهاتف بشكل صحيح."));
        return;
      }
      phonePatch = { phoneE164: result.e164, phoneCountryCode: country?.callingCode ?? undefined, phoneCountryName: country?.nameAr ?? undefined };
    }
    setSaving(true);
    try {
      await update.mutateAsync({
        username: username.trim() || undefined,
        firstName: firstName.trim() || undefined,
        lastName: lastName.trim() || undefined,
        fullName: [firstName.trim(), lastName.trim()].filter(Boolean).join(" ") || undefined,
        birthDate: birthDate.trim() || undefined,
        gender: gender || undefined,
        nationality: nationalityCode || undefined,
        residence: residence.trim() || undefined,
        ...phonePatch,
      });
      router.back();
    } catch (e: unknown) {
      const errorWithCode = e as { message?: string; code?: string };
      const msg = errorWithCode.message?.includes("duplicate") || errorWithCode.code === "23505"
        ? t("اسم المستخدم ده مستخدم بالفعل، جرب اسم تاني")
        : logAndGetSafeMessage("EditProfile.save", e, t("تعذر حفظ البيانات، تحقق من تسجيل الدخول وحاول مرة أخرى"));
      Alert.alert(t("خطأ"), msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable style={styles.closeBtn} onPress={() => router.back()} hitSlop={8}>
          <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#111" strokeWidth={2}>
            <Path d="M18 6L6 18M6 6l12 12" />
          </Svg>
        </Pressable>
        <Text style={styles.headerTitle}>{t("تعديل بيانات الحساب")}</Text>
        <Pressable onPress={handleSave} disabled={saving} hitSlop={8}>
          {saving ? <ActivityIndicator color="#22A652" /> : <Text style={styles.saveText}>{t("حفظ")}</Text>}
        </Pressable>
      </View>

      {isLoading && !hydrated ? (
        <View style={styles.loadingWrap}><ActivityIndicator color="#22A652" /></View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <Pressable style={styles.avatarWrap} onPress={pickAvatar}>
            {avatarUri ? (
              <Image source={{ uri: cldOptimized(avatarUri, "w_300,h_300,c_fill,q_auto,f_auto") }} style={StyleSheet.absoluteFill} contentFit="cover" />
            ) : (
              <Svg width={34} height={34} viewBox="0 0 24 24" fill="none" stroke="#22A652" strokeWidth={2}>
                <Circle cx={12} cy={8} r={4} /><Path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
              </Svg>
            )}
            <View style={styles.avatarEditBadge}>
              <Svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5}>
                <Path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
              </Svg>
            </View>
          </Pressable>

          <FormLabel text={t("اسم المستخدم")} optional />
          <FormInput value={username} onChangeText={setUsername} placeholder={t("اسم المستخدم")} autoCapitalize="none" />

          <FormLabel text={t("الاسم الأول")} optional />
          <FormInput value={firstName} onChangeText={setFirstName} placeholder={t("الاسم الأول")} />

          <FormLabel text={t("الاسم الثاني")} optional />
          <FormInput value={lastName} onChangeText={setLastName} placeholder={t("الاسم الثاني")} />

          <FormLabel text={t("تاريخ الميلاد")} optional />
          <FormInput value={birthDate} onChangeText={setBirthDate} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" />

          <FormLabel text={t("الجنس")} optional />
          <ChipRow options={["male", "female"]} value={gender} onChange={setGender} labels={{ male: "ذكر", female: "أنثى" }} />

          <FormLabel text={t("الجنسية")} optional />
          <Pressable style={styles.selectBox} onPress={() => setNationalityPickerVisible(true)}>
            <Text style={nationalityCountry ? styles.selectText : styles.selectPlaceholder}>
              {nationalityCountry ? (language === "ar" ? nationalityCountry.nameAr : nationalityCountry.nameEn) : t("اختر الجنسية")}
            </Text>
          </Pressable>

          <FormLabel text={t("الإقامة")} optional />
          <ProvinceAutocomplete value={residence} onChange={setResidence} />

          <FormLabel text={t("رقم الهاتف")} optional />
          <PhoneInput value={phone} onChange={setPhone} />

          <View style={{ height: 40 }} />
        </ScrollView>
      )}

      <CountryPickerModal
        visible={nationalityPickerVisible}
        selectedCode={nationalityCode}
        onSelect={(c) => { setNationalityCode(c.code); setNationalityPickerVisible(false); }}
        onClose={() => setNationalityPickerVisible(false)}
      />
    </View>
  );
}

function createStyles(themeColors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: themeColors.background },
    header: {
      flexDirection: "row", alignItems: "center", justifyContent: "space-between",
      paddingHorizontal: 14, paddingTop: 54, paddingBottom: 14, backgroundColor: themeColors.background,
    },
    closeBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: themeColors.surface, alignItems: "center", justifyContent: "center" },
    headerTitle: { fontSize: 15, fontWeight: "900", color: themeColors.text },
    saveText: { fontSize: 14, fontWeight: "900", color: "#22A652" },
    loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
    scroll: { padding: 16, paddingBottom: 40 },
    avatarWrap: {
      width: 96, height: 96, borderRadius: 48, backgroundColor: themeColors.isDark ? "rgba(34,166,82,0.18)" : "#ecfdf5",
      alignItems: "center", justifyContent: "center", overflow: "hidden", alignSelf: "center", marginBottom: 24, position: "relative",
    },
    avatarEditBadge: { position: "absolute", bottom: 2, right: 2, width: 26, height: 26, borderRadius: 13, backgroundColor: "#111827", borderWidth: 2, borderColor: themeColors.background, alignItems: "center", justifyContent: "center" },
    selectBox: { backgroundColor: themeColors.surface, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14, marginBottom: 14 },
    selectText: { fontSize: 13.5, fontWeight: "700", color: themeColors.text },
    selectPlaceholder: { fontSize: 13.5, fontWeight: "700", color: themeColors.textSubtle },
  });
}
