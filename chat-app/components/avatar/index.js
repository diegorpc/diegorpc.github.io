import { computed } from "vue";

export default {
  props: {
    photoUrl: { type: String, default: null },
    iconUrl: { type: String, default: null },
    initial: { type: String, default: null },
    title: { type: String, default: null },
    size: { type: String, default: "default" }, // 'small', 'default', 'large'
  },
  setup(props) {
    // Use either photoUrl or iconUrl
    const imageUrl = computed(() => props.photoUrl || props.iconUrl);
    
    // Calculate fallback text from initial or title
    const fallbackText = computed(() => {
      if (props.initial) {
        return props.initial.substring(0, 1).toUpperCase();
      }
      if (props.title) {
        return props.title.substring(0, 2).toUpperCase();
      }
      return "?";
    });

    return {
      imageUrl,
      fallbackText,
    };
  },
};
